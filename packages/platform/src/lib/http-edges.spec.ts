import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import type { Db } from './db.ts';
import type { CommandRunner } from './exec.ts';
import { createMemoryGit } from './git/memory.ts';
import { createPlatform, type Platform } from './runtime.ts';
import { apiSource } from './sources.ts';
import { createMemoryStorage } from './storage.ts';
import { createTestDb } from './testing/pglite.ts';

const env = {
  DOCKUDOS_DATABASE_URL: 'postgres://u:pw-secret-123@db/x',
  DOCKUDOS_PUBLIC_URL: 'https://platform.test',
  DOCKUDOS_DATA_DIR: join(tmpdir(), 'dkd-http-edges'),
  DOCKUDOS_SESSION_SECRET: 's'.repeat(40),
  DOCKUDOS_SITES_DOMAIN: 'sites.test',
  DOCKUDOS_LOG_LEVEL: 'silent',
};
const run: CommandRunner = async ({ args, cwd }) => {
  if (args.includes('build')) {
    await mkdir(join(cwd, 'out'), { recursive: true });
    await writeFile(join(cwd, 'out/index.html'), '<h1>x</h1>');
  }
  return { code: 0 };
};

let db: Db;
let git: ReturnType<typeof createMemoryGit>;
let p: Platform;
let teamId: string;
let key: string;
beforeAll(async () => {
  db = await createTestDb();
  git = createMemoryGit('github');
  p = await platform(env);
  const owner = await p.auth.upsertUser({
    sub: 'edge-owner',
    email: 'edge@x.test',
    roles: [],
    groups: [],
  });
  const actor = { type: 'user', user: owner } as const;
  teamId = (await p.auth.createTeam(actor, 'Edge Team')).id;
  key = (await p.auth.createApiKey(actor, teamId, 'ci', 'admin')).secret;
});
afterAll(() => db.close());

const platform = (e: Record<string, string>) =>
  createPlatform(loadConfig(e), {
    db,
    storage: createMemoryStorage(),
    providers: { github: git },
    run,
    source: apiSource,
  });
const call = (
  path: string,
  init: RequestInit & { ip?: string } = {},
  as: string | undefined = key,
  target: Platform = p,
) => {
  const { ip, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (as) headers.set('authorization', `Bearer ${as}`);
  return target.handler(
    new Request(`https://platform.test${path}`, { ...rest, headers }),
    { ip: ip ?? '198.51.100.7' },
  );
};
const post = (
  path: string,
  body: string,
  headers: Record<string, string> = {},
) => call(path, { method: 'POST', body, headers });
const j = async (r: Response) => (await r.json()) as any;
let n = 0;
async function newSite(target: Platform = p) {
  const repo = `acme/edge-${++n}-${Math.random().toString(36).slice(2, 6)}`;
  git.seed(repo, { 'docs.json': '{}', 'index.mdx': '# Hi' });
  const r = await call(
    `/api/v1/teams/${teamId}/sites`,
    {
      method: 'POST',
      body: JSON.stringify({ name: `Edge ${n}`, provider: 'github', repo }),
    },
    key,
    target,
  );
  expect(r.status).toBe(201);
  return j(r) as Promise<{
    site: { id: string; slug: string };
    webhookSecret: string;
  }>;
}

describe('deleting a site', () => {
  it('removes it and its routes', async () => {
    const { site } = await newSite();
    const del = await call(`/api/v1/sites/${site.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await j(del)).toEqual({ ok: true });
    expect((await call(`/api/v1/sites/${site.id}`)).status).toBe(404);
  });
});

describe('the public address of a site', () => {
  it.each([
    ['https://platform.test', 'https://SLUG.sites.test'],
    ['https://platform.test:8443', 'https://SLUG.sites.test:8443'],
    ['https://platform.test:443', 'https://SLUG.sites.test'],
    ['http://platform.test:80', 'http://SLUG.sites.test'],
  ])('%s -> %s', async (publicUrl, expected) => {
    const other = await platform({ ...env, DOCKUDOS_PUBLIC_URL: publicUrl });
    const { site } = await newSite(other);
    const body = await j(
      await call(`/api/v1/sites/${site.id}`, {}, key, other),
    );
    expect(body.url).toBe(expected.replace('SLUG', site.slug));
  });

  it('has none without a sites domain', async () => {
    const { DOCKUDOS_SITES_DOMAIN: _drop, ...rest } = env;
    const other = await platform(rest);
    const { site } = await newSite(other);
    const body = await j(
      await call(`/api/v1/sites/${site.id}`, {}, key, other),
    );
    expect(body.url).toBeUndefined();
  });
});

describe('body handling', () => {
  it.each([
    ['an array', '[]'],
    ['a number', '5'],
    ['null', 'null'],
    ['broken JSON', '{ nope'],
  ])('rejects %s as a request body', async (_n, body) => {
    const r = await post(`/api/v1/teams/${teamId}/sites`, body);
    expect(r.status).toBe(400);
    expect((await j(r)).error.code).toBe('bad_request');
  });

  it('refuses a declared body that is too large without reading it', async () => {
    const r = await post(`/api/v1/teams/${teamId}/sites`, '{}', {
      'content-length': String(10 * 1024 * 1024),
    });
    expect(r.status).toBe(413);
  });

  it('refuses a body that grows past the limit while streaming', async () => {
    const big = JSON.stringify({ name: 'x'.repeat(300 * 1024) });
    const r = await post(`/api/v1/teams/${teamId}/sites`, big);
    expect(r.status).toBe(413);
    expect((await j(r)).error.code).toBe('too_large');
  });
});

describe('analytics ingest, hostile input', () => {
  let siteId: string;
  beforeAll(async () => (siteId = (await newSite()).site.id));
  const ingest = (body: string, headers: Record<string, string> = {}) =>
    call(
      `/api/v1/ingest/${siteId}`,
      { method: 'POST', body, headers },
      undefined,
    );

  it('answers 413 with CORS headers to an oversized beacon', async () => {
    const r = await ingest(JSON.stringify({ path: 'x'.repeat(9 * 1024) }));
    expect(r.status).toBe(413);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers 413 when the declared length is already over the limit', async () => {
    const r = await ingest('{}', { 'content-length': '100000' });
    expect(r.status).toBe(413);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it.each([['not json at all'], ['5'], ['"a string"'], ['null']])(
    'answers 400 to %s',
    async (body) => {
      const r = await ingest(body);
      expect(r.status).toBe(400);
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
    },
  );

  it('does not leak an internal error from the recorder', async () => {
    const original = p.analytics.ingest;
    p.analytics.ingest = async () => {
      throw new Error('disk exploded at /var/secret');
    };
    try {
      const r = await ingest(JSON.stringify({ kind: 'pageview', path: '/x' }), {
        'user-agent': 'UA',
      });
      expect(r.status).toBe(500);
      expect(JSON.stringify(await j(r))).not.toContain('/var/secret');
    } finally {
      p.analytics.ingest = original;
    }
  });
});

describe('client address', () => {
  it('falls back to X-Real-IP, then the socket, only when the proxy is trusted', async () => {
    const { site } = await newSite();
    const visitor = async (path: string) =>
      (
        (
          await db.query(
            'SELECT visitor FROM analytics_events WHERE path = $1 ORDER BY id DESC LIMIT 1',
            [path],
          )
        ).rows[0] as { visitor: string }
      ).visitor;
    const trusted = await platform({ ...env, DOCKUDOS_TRUST_PROXY: 'true' });
    const beacon = (
      path: string,
      headers: Record<string, string>,
      ip?: string,
    ) =>
      call(
        `/api/v1/ingest/${site.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'pageview', path }),
          headers: { 'user-agent': 'UA', ...headers },
          ...(ip && { ip }),
        },
        undefined,
        trusted,
      );
    await beacon('/real-a', { 'x-real-ip': '192.0.2.1' }, '10.0.0.1');
    await beacon('/real-b', { 'x-real-ip': '192.0.2.1' }, '10.0.0.2');
    await beacon('/real-c', { 'x-real-ip': '198.51.100.2' }, '10.0.0.1');
    // The visitor hash truncates the address to its network, so only a different network tells visitors apart.
    expect(await visitor('/real-a')).toBe(await visitor('/real-b'));
    expect(await visitor('/real-a')).not.toBe(await visitor('/real-c'));
    // No forwarding headers at all: the socket address decides.
    await beacon('/sock-a', {}, '10.0.0.7');
    await beacon('/sock-b', {}, '10.0.0.7');
    expect(await visitor('/sock-a')).toBe(await visitor('/sock-b'));
  });
});

describe('rate limits and failures', () => {
  it('throttles deliveries to one hook address, with Retry-After', async () => {
    const { site } = await newSite();
    let last: Response | undefined;
    for (let i = 0; i < 130; i++) {
      last = await call(
        `/hooks/github/${site.id}`,
        {
          method: 'POST',
          body: '{}',
        },
        undefined,
      );
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await j(last!)).error.code).toBe('rate_limited');
  });

  it('answers 500 with a fixed message and logs the cause, never returning it', async () => {
    const original = p.sites.list;
    p.sites.list = async () => {
      throw new Error('secret connection string postgres://u:pw@db');
    };
    try {
      const r = await call(`/api/v1/teams/${teamId}/sites`);
      expect(r.status).toBe(500);
      const body = await j(r);
      expect(body.error).toEqual({
        code: 'internal',
        message: 'Something went wrong.',
      });
      expect(JSON.stringify(body)).not.toContain('postgres://');
    } finally {
      p.sites.list = original;
    }
  });

  it('throttles an API key that sends too many requests', async () => {
    const other = await platform(env);
    let status = 0;
    let retry: string | null = null;
    for (let i = 0; i < 620 && status !== 429; i++) {
      const r = await call(`/api/v1/teams/${teamId}/sites`, {}, key, other);
      status = r.status;
      retry = r.headers.get('retry-after');
    }
    expect(status).toBe(429);
    expect(retry).toBe('30');
  });
});
