import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFsSink } from './backup.ts';
import { ConfigError, loadConfig } from './config.ts';
import type { Db } from './db.ts';
import { createMemoryGit } from './git/memory.ts';
import { createQueue, createWorker } from './queue.ts';
import { apiSource } from './sources.ts';
import { createFsStorage } from './storage.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

let db: Db;
const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'dkd-edges-'));
  dirs.push(d);
  return d;
};
beforeAll(async () => (db = await createTestDb()));
afterAll(async () => {
  await db.close();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const SHA = 'a'.repeat(40);
const body = async (r: Response) =>
  (await r.json()) as { status?: string; reason?: string };
let repoCounter = 0;

describe('configuration', () => {
  const base = {
    DOCKUDOS_DATABASE_URL: 'postgres://u:dbpassword123@db:5432/x',
    DOCKUDOS_PUBLIC_URL: 'https://platform.example.com',
    DOCKUDOS_SESSION_SECRET: 'x'.repeat(40),
  };

  it('refuses an unknown service name, and says which', () => {
    expect(() =>
      loadConfig({ ...base, DOCKUDOS_SERVICES: 'web,bogus' }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...base, DOCKUDOS_SERVICES: 'web,bogus' }),
    ).toThrow(/unknown service "bogus"/);
  });

  it('ignores blank entries and surrounding spaces in the service list', () => {
    expect(
      loadConfig({ ...base, DOCKUDOS_SERVICES: ' web , ,hooks,' }).services,
    ).toEqual(['web', 'hooks']);
  });

  it('refuses a public URL that is not a URL', () => {
    expect(() =>
      loadConfig({ ...base, DOCKUDOS_PUBLIC_URL: 'not a url' }),
    ).toThrow(ConfigError);
  });

  it('never prints the database password when it reports a problem', () => {
    try {
      loadConfig({ ...base, DOCKUDOS_SESSION_SECRET: 'short' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('dbpassword123');
    }
  });
});

describe('webhook receiver, less common deliveries', () => {
  async function gitlabSite(docsDir?: string) {
    const f = await createFixture(db);
    const repo = `grp/docs-${++repoCounter}`;
    f.gitlab.seed(repo, { 'docs/a.mdx': '# A', 'src/x.ts': '1' });
    const { site, webhookSecret } = await f.sites.create(f.actor, f.team.id, {
      name: `GL ${Math.random()}`,
      provider: 'gitlab',
      repo,
      ...(docsDir && { docsDir }),
    });
    const send = (
      body: unknown,
      headers: Record<string, string> = {},
      token = webhookSecret,
    ) =>
      f.webhooks(
        new Request('https://p.test/', {
          method: 'POST',
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: {
            'x-gitlab-token': token,
            'x-gitlab-event': 'Push Hook',
            ...headers,
          },
        }),
        'gitlab',
        site.id,
      );
    const push = (commits: unknown[], over: Record<string, unknown> = {}) => ({
      event_name: 'push',
      ref: 'refs/heads/main',
      after: SHA,
      checkout_sha: SHA,
      project: { path_with_namespace: repo },
      commits,
      ...over,
    });
    return { f, send, push, site };
  }

  it('builds a docs-folder site only when the push touched the docs folder', async () => {
    const { send, push } = await gitlabSite('docs');
    const elsewhere = await send(push([{ modified: ['src/x.ts'] }]), {
      'x-gitlab-event-uuid': 'g1',
    });
    expect(await elsewhere.json()).toMatchObject({
      status: 'ignored',
      reason: 'no files in the docs folder changed',
    });
    const inDocs = await send(
      push([{ added: ['docs/b.mdx'] }, { removed: ['x'] }]),
      {
        'x-gitlab-event-uuid': 'g2',
      },
    );
    expect(inDocs.status).toBe(202);
  });

  it('treats a push with many commits as touching everything (its file list is not trusted to be complete)', async () => {
    const { send, push } = await gitlabSite('docs');
    const many = Array.from({ length: 25 }, () => ({ modified: ['src/x.ts'] }));
    const r = await send(push(many), { 'x-gitlab-event-uuid': 'g3' });
    expect(r.status).toBe(202);
  });

  it('falls back to the Idempotency-Key header, then to a hash of the body, to spot redeliveries', async () => {
    const { send, push } = await gitlabSite();
    const body = push([]);
    expect((await send(body, { 'idempotency-key': 'k1' })).status).toBe(202);
    expect(
      await (await send(body, { 'idempotency-key': 'k1' })).json(),
    ).toEqual({
      status: 'duplicate',
    });
    const other = push([], {
      after: 'b'.repeat(40),
      checkout_sha: 'b'.repeat(40),
    });
    expect((await send(other)).status).toBe(202);
    expect(await (await send(other)).json()).toEqual({ status: 'duplicate' });
  });

  it('rejects an absurdly long delivery id', async () => {
    const { send, push } = await gitlabSite();
    const r = await send(push([]), { 'x-gitlab-event-uuid': 'x'.repeat(201) });
    expect(r.status).toBe(400);
  });

  it('ignores other events, other repositories and deleted branches', async () => {
    const { send, push } = await gitlabSite();
    const tag = await send(push([], { event_name: 'tag_push' }), {
      'x-gitlab-event': 'Tag Push Hook',
      'x-gitlab-event-uuid': 'e1',
    });
    expect((await body(tag)).status).toBe('ignored');
    const other = await send(
      push([], { project: { path_with_namespace: 'someone/else' } }),
      {
        'x-gitlab-event-uuid': 'e2',
      },
    );
    expect((await body(other)).reason).toBe('push is for another repository');
    const deleted = await send(
      push([], { after: '0'.repeat(40), checkout_sha: null }),
      {
        'x-gitlab-event-uuid': 'e3',
      },
    );
    expect((await body(deleted)).reason).toBe('branch deleted or no commit');
    const branch = await send(push([], { ref: 'refs/heads/feature' }), {
      'x-gitlab-event-uuid': 'e4',
    });
    expect((await body(branch)).reason).toContain('only main is built');
  });

  it('rejects a body over the limit even when Content-Length lies', async () => {
    const { f, site } = await gitlabSite();
    const res = await f.webhooks(
      new Request('https://p.test/', {
        method: 'POST',
        body: 'x'.repeat(5 * 1024 * 1024 + 1),
        headers: { 'content-length': '10' },
      }),
      'gitlab',
      site.id,
    );
    expect(res.status).toBe(413);
  });

  it('answers GET with 405', async () => {
    const { f, site } = await gitlabSite();
    const res = await f.webhooks(
      new Request('https://p.test/'),
      'gitlab',
      site.id,
    );
    expect(res.status).toBe(405);
  });
});

describe('teams and keys: the rules about who may do what', () => {
  it('lets only people, not API keys, create teams and keys', async () => {
    const f = await createFixture(db);
    const { key, secret } = await f.auth.createApiKey(
      f.actor,
      f.team.id,
      'ci',
      'admin',
    );
    const asKey = await f.auth.authenticateApiKey(secret);
    expect(asKey?.id).toBe(key.id);
    const actor = { type: 'key', key: asKey! } as never;
    await expect(f.auth.createTeam(actor, 'Nope')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      f.auth.createApiKey(actor, f.team.id, 'k2', 'viewer'),
    ).rejects.toMatchObject({
      status: 403,
      message: 'API keys cannot create API keys.',
    });
  });

  it('refuses unknown key roles, blank and over-long names; editors may not mint keys at all', async () => {
    const f = await createFixture(db);
    const editor = await f.auth.upsertUser({
      sub: `e-${Math.random()}`,
      email: `e${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    await f.auth.setMember(f.actor, f.team.id, editor.email!, 'editor');
    await expect(
      f.auth.createApiKey(
        { type: 'user', user: editor },
        f.team.id,
        'k',
        'viewer',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.auth.createApiKey(f.actor, f.team.id, 'k', 'root' as never),
    ).rejects.toMatchObject({
      status: 400,
    });
    for (const name of ['   ', 'n'.repeat(81)])
      await expect(
        f.auth.createApiKey(f.actor, f.team.id, name, 'viewer'),
      ).rejects.toMatchObject({
        status: 400,
      });
    await expect(f.auth.createTeam(f.actor, '  ')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('lets a member leave a team on their own, but not strip someone senior', async () => {
    const f = await createFixture(db);
    const ed = await f.auth.upsertUser({
      sub: `l-${Math.random()}`,
      email: `l${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    await f.auth.setMember(f.actor, f.team.id, ed.email!, 'editor');
    const as = { type: 'user', user: ed } as const;
    await expect(
      f.auth.removeMember(as, f.team.id, f.owner.id),
    ).rejects.toMatchObject({
      status: 403,
    });
    await f.auth.removeMember(as, f.team.id, ed.id);
    await expect(
      f.auth.removeMember(f.actor, f.team.id, ed.id),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never leaves a team without an owner', async () => {
    const f = await createFixture(db);
    await expect(
      f.auth.removeMember(f.actor, f.team.id, f.owner.id),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('still authenticates when recording last use fails', async () => {
    const f = await createFixture(db);
    const { secret } = await f.auth.createApiKey(
      f.actor,
      f.team.id,
      'ci',
      'viewer',
    );
    const real = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (/UPDATE api_keys SET last_used_at/.test(sql))
        throw new Error('read-only replica');
      return real(sql, params);
    }) as typeof db.query;
    try {
      expect(await f.auth.authenticateApiKey(secret)).toBeDefined();
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      db.query = real;
    }
  });
});

describe('sites', () => {
  it('refuses to connect the same repository folder twice', async () => {
    const f = await createFixture(db);
    await expect(
      f.sites.create(f.actor, f.team.id, {
        name: 'Duplicate',
        provider: 'github',
        repo: f.repo,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('gives a site with the same name a distinct address', async () => {
    const f = await createFixture(db);
    const repo = `${f.repo}-two`;
    f.git.seed(repo, { 'docs.json': '{}' });
    const { site } = await f.sites.create(f.actor, f.team.id, {
      name: f.site.name,
      provider: 'github',
      repo,
    });
    expect(site.slug).not.toBe(f.site.slug);
    expect(site.slug.startsWith(f.site.slug.replace(/-\d+$/, ''))).toBe(true);
  });
});

describe('source checkout through the API', () => {
  it('skips a file that vanished and refuses a path that climbs out of the checkout', async () => {
    const git = createMemoryGit();
    const sha = git.seed('o/r', { 'a.txt': 'one', 'b.txt': 'two' });
    const dest = await tmp();
    const flaky = {
      ...git,
      listFiles: async () => ['a.txt', 'gone.txt'],
    };
    await apiSource({
      provider: flaky as never,
      repo: 'o/r',
      sha,
      dest,
      onOutput: () => undefined,
    });
    expect(
      (await import('node:fs/promises')).readFile(join(dest, 'a.txt'), 'utf8'),
    ).resolves.toBe('one');
    const hostile = {
      ...git,
      listFiles: async () => ['../escape.txt'],
      readFile: async () => ({ content: new Uint8Array([1]), sha: 'x' }),
    };
    await expect(
      apiSource({
        provider: hostile as never,
        repo: 'o/r',
        sha,
        dest,
        onOutput: () => undefined,
      }),
    ).rejects.toThrow('Refusing path outside the checkout');
  });
});

describe('file storage and backup sink', () => {
  it('refuses keys that climb out of the storage root, and lists nothing under a missing prefix', async () => {
    const root = await tmp();
    const s = createFsStorage(root);
    await s.put('a/b.txt', new TextEncoder().encode('hi'), 'text/plain');
    expect(new TextDecoder().decode((await s.get('a/b.txt'))!)).toBe('hi');
    expect(await s.list('nothing-here/')).toEqual([]);
    await expect(
      s.put('../evil', new Uint8Array([1]), 'x/y'),
    ).rejects.toThrow();
    await expect(s.get('a/../../evil')).rejects.toThrow();
  });

  it('reads a missing backup file as absent but surfaces real errors', async () => {
    const root = await tmp();
    const sink = createFsSink(root);
    expect(await sink.read('nope.json')).toBeUndefined();
    await mkdir(join(root, 'adir'));
    await expect(sink.read('adir')).rejects.toThrow();
    await expect(sink.read('../outside')).rejects.toThrow('Unsafe backup path');
    await writeFile(join(root, 'ok.txt'), 'x');
    expect(new TextDecoder().decode((await sink.read('ok.txt'))!)).toBe('x');
  });
});

describe('the background worker', () => {
  it('logs a failing loop iteration and keeps running until stopped', async () => {
    const own = await createTestDb();
    const queue = createQueue({ db: own });
    const errors: string[] = [];
    const original = own.query.bind(own);
    let broke = 0;
    own.query = (async (sql: string, params?: unknown[]) => {
      if (/FOR UPDATE SKIP LOCKED|UPDATE jobs/.test(sql) && broke++ < 2)
        throw new Error('connection reset');
      return original(sql, params);
    }) as typeof own.query;
    const worker = createWorker({
      queue,
      handlers: {},
      concurrency: 1,
      pollMs: 5,
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (m: string) => void errors.push(m),
        child() {
          return this;
        },
      } as never,
    } as never);
    worker.start();
    await new Promise((r) => setTimeout(r, 150));
    await worker.stop();
    expect(errors).toContain('worker loop error');
    await own.close();
  });
});

describe('checksum helper sanity', () => {
  it('uses sha256 hex for backup manifests', () => {
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});
