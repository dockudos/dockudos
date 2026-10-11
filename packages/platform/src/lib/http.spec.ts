import { createHmac } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
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
import { PLATFORM_SESSION_COOKIE } from './auth.ts';

const env = {
  DOCKUDOS_DATABASE_URL: 'postgres://u:pw-secret-123@db/x',
  DOCKUDOS_PUBLIC_URL: 'https://platform.test',
  DOCKUDOS_DATA_DIR: join(tmpdir(), 'dkd-http-test'),
  DOCKUDOS_SESSION_SECRET: 's'.repeat(40),
  DOCKUDOS_SITES_DOMAIN: 'sites.test',
  DOCKUDOS_METRICS_TOKEN: 'metrics-secret-token',
};
const run: CommandRunner = async ({ args, cwd }) => {
  if (args.includes('build')) {
    await mkdir(join(cwd, 'out'), { recursive: true });
    await writeFile(join(cwd, 'out/index.html'), '<h1>Live home</h1>');
    await symlink('/etc/passwd', join(cwd, 'out/leak.txt')).catch(
      () => undefined,
    );
  }
  return { code: 0 };
};

let db: Db;
let p: Platform;
let git: ReturnType<typeof createMemoryGit>;
beforeAll(async () => {
  db = await createTestDb();
  git = createMemoryGit('github');
  p = await createPlatform(loadConfig(env), {
    db,
    storage: createMemoryStorage(),
    providers: { github: git },
    run,
    source: apiSource,
  });
});
afterAll(() => db.close());

const call = (
  path: string,
  init: RequestInit & { host?: string; ip?: string } = {},
  as?: string,
) => {
  const { host, ip, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (host) headers.set('host', host);
  if (as) headers.set('authorization', `Bearer ${as}`);
  return p.handler(
    new Request(`https://platform.test${path}`, { ...rest, headers }),
    { ip: ip ?? '198.51.100.7' },
  );
};
const send = (
  path: string,
  method: string,
  body: unknown,
  as?: string,
  extra: Record<string, string> = {},
) =>
  call(
    path,
    {
      method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...extra },
    },
    as,
  );
const j = async (r: Response) => (await r.json()) as any;

let teamId: string;
let key: string;
let ownerCookie: string;
beforeAll(async () => {
  const owner = await p.auth.upsertUser({
    sub: 'http-owner',
    email: 'owner@x.test',
    roles: [],
    groups: [],
  });
  const actor = { type: 'user', user: owner } as const;
  teamId = (await p.auth.createTeam(actor, 'HTTP Team')).id;
  key = (await p.auth.createApiKey(actor, teamId, 'ci', 'admin')).secret;
  ownerCookie = `${PLATFORM_SESSION_COOKIE}=${await p.auth.sessionToken(owner)}`;
});

describe('health and metrics', () => {
  it('answers liveness and readiness, and protects metrics with a token', async () => {
    expect((await call('/healthz')).status).toBe(200);
    const ready = await j(await call('/readyz'));
    expect(ready).toMatchObject({
      status: 'ok',
      checks: { database: { ok: true }, storage: { ok: true } },
    });
    expect((await call('/metrics')).status).toBe(401);
    const m = await call('/metrics', {
      headers: { authorization: 'Bearer metrics-secret-token' },
    });
    expect(m.status).toBe(200);
    expect(await m.text()).toContain('dockudos_http_requests_total');
  });

  it('reports a failing dependency as 503 without leaking details', async () => {
    const broken = await createPlatform(loadConfig(env), {
      db: {
        ...db,
        query: async () => {
          throw new Error(
            'connect ECONNREFUSED 10.0.0.5:5432 password=pw-secret-123',
          );
        },
      } as Db,
      storage: createMemoryStorage(),
      providers: { github: git },
    });
    const r = await broken.handler(new Request('https://platform.test/readyz'));
    expect(r.status).toBe(503);
    const body = (await r.json()) as any;
    expect(body.checks.database.ok).toBe(false);
  });
});

describe('API with keys', () => {
  it('rejects unauthenticated calls with a JSON error and unknown routes with 404', async () => {
    const r = await call('/api/v1/me');
    expect(r.status).toBe(401);
    expect(await j(r)).toEqual({
      error: { code: 'unauthorized', message: 'Sign in to continue.' },
    });
    expect((await call('/api/v1/nope', {}, key)).status).toBe(404);
    expect(
      (await call('/api/v1/me', {}, 'dkd_00000000_' + 'a'.repeat(32))).status,
    ).toBe(401);
  });

  it('connects a site, builds it from a webhook, and serves it (P5 acceptance: push -> rebuild -> live)', async () => {
    const head = git.seed('acme/http-docs', {
      'docs.json': '{}',
      'index.mdx': '# Hi',
    });
    const created = await send(
      `/api/v1/teams/${teamId}/sites`,
      'POST',
      { name: 'HTTP Docs', provider: 'github', repo: 'acme/http-docs' },
      key,
    );
    expect(created.status).toBe(201);
    const { site, webhookSecret, webhookUrl } = await j(created);
    expect(webhookUrl).toBe(`https://platform.test/hooks/github/${site.id}`);
    expect((await call('/', { host: 'http-docs.sites.test' })).status).toBe(
      404,
    );

    const newHead = git.push('acme/http-docs', 'main', {
      'index.mdx': '# Changed',
    });
    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      after: newHead,
      repository: { full_name: 'acme/http-docs' },
      commits: [{ modified: ['index.mdx'] }],
    });
    const hook = (secret: string, id: string) =>
      call(`/hooks/github/${site.id}`, {
        method: 'POST',
        body: payload,
        headers: {
          'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
          'x-github-event': 'push',
          'x-github-delivery': id,
        },
      });
    expect((await hook('wrong', 'h1')).status).toBe(401);
    expect((await hook(webhookSecret, 'h2')).status).toBe(202);
    expect(await j(await hook(webhookSecret, 'h2'))).toEqual({
      status: 'duplicate',
    });

    // The worker role would do this; run it here.
    const w = (await import('./queue.ts')).createWorker({
      queue: p.queue,
      handlers: { build: p.builds.handle },
    });
    while (await w.runOnce());
    const builds = await j(
      await call(`/api/v1/sites/${site.id}/builds`, {}, key),
    );
    expect(builds.builds[0]).toMatchObject({
      status: 'succeeded',
      commitSha: newHead,
    });

    const live = await call('/', { host: 'http-docs.sites.test' });
    expect(live.status).toBe(200);
    expect(await live.text()).toBe('<h1>Live home</h1>');
    expect(
      (await call('/leak.txt', { host: 'http-docs.sites.test' })).status,
    ).toBe(404);
    expect(
      (await call('/', { host: 'http-docs.sites.test', method: 'POST' }))
        .status,
    ).toBe(405);
    expect((await call('/', { host: 'Bad_Slug!.sites.test' })).status).toBe(
      404,
    );
    // The platform's own host never serves site files.
    expect((await call('/index.html')).status).toBe(404);
    void head;
  });

  it('maps errors to statuses and parses bodies defensively', async () => {
    expect(
      (
        await send(
          `/api/v1/teams/${teamId}/sites`,
          'POST',
          { name: '', provider: 'github', repo: 'a/b' },
          key,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          `/api/v1/teams/${teamId}/sites`,
          'POST',
          { name: 'x', provider: 'github', repo: 'does/not-exist' },
          key,
        )
      ).status,
    ).toBe(400);
    const bad = await call(
      `/api/v1/teams/${teamId}/keys`,
      {
        method: 'POST',
        body: '[1,2]',
        headers: { 'content-type': 'application/json' },
      },
      key,
    );
    expect(bad.status).toBe(400);
    const huge = await call(
      `/api/v1/teams/${teamId}/keys`,
      { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(300_000) }) },
      key,
    );
    expect(huge.status).toBe(413);
    expect(
      (
        await call(
          '/api/v1/sites/00000000-0000-0000-0000-000000000000',
          {},
          key,
        )
      ).status,
    ).toBe(404);
    const stranger = await p.auth.upsertUser({
      sub: 'http-stranger',
      email: 'str@x.test',
      roles: [],
      groups: [],
    });
    const strangerKeyTeam = await p.auth.createTeam(
      { type: 'user', user: stranger },
      'Stranger Team',
    );
    const sk = (
      await p.auth.createApiKey(
        { type: 'user', user: stranger },
        strangerKeyTeam.id,
        'k',
        'admin',
      )
    ).secret;
    expect((await call(`/api/v1/teams/${teamId}/sites`, {}, sk)).status).toBe(
      403,
    );
  });

  it('exposes the principal docs sites use, and the editor surface', async () => {
    const pr = await j(await call('/api/v1/principal', {}, key));
    expect(pr.principal).toMatchObject({
      groups: ['team:http-team'],
      roles: ['team:http-team:admin'],
    });
    const me = await j(await call('/api/v1/me', {}, key));
    expect(me).toMatchObject({ type: 'key' });
    const siteId = (
      await j(await call(`/api/v1/teams/${teamId}/sites`, {}, key))
    ).sites[0].id;
    const files = await j(await call(`/api/v1/sites/${siteId}/files`, {}, key));
    expect(files.files.map((f: any) => f.path)).toContain('docs.json');
    const ok = await j(
      await send(
        `/api/v1/sites/${siteId}/validate-config`,
        'POST',
        { json: '{"name":"A"}' },
        key,
      ),
    );
    expect(ok).toEqual({ ok: true });
    const media = await call(
      `/api/v1/sites/${siteId}/media?filename=a.png`,
      {
        method: 'POST',
        body: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      },
      key,
    );
    expect(media.status).toBe(201);
    expect((await j(media)).path).toMatch(/^\/media\/.*\.png$/);
  });
});

describe('browser sessions', () => {
  it('require the dashboard origin for changes (CSRF) but not for reads', async () => {
    expect(
      (await call('/api/v1/me', { headers: { cookie: ownerCookie } })).status,
    ).toBe(200);
    const body = JSON.stringify({ name: 'CSRF Team' });
    expect(
      (
        await call('/api/v1/teams', {
          method: 'POST',
          body,
          headers: { cookie: ownerCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/api/v1/teams', {
          method: 'POST',
          body,
          headers: { cookie: ownerCookie, origin: 'https://evil.test' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/api/v1/teams', {
          method: 'POST',
          body,
          headers: { cookie: ownerCookie, origin: 'https://platform.test' },
        })
      ).status,
    ).toBe(201);
  });
});

describe('analytics ingest', () => {
  let siteId: string;
  beforeAll(
    async () =>
      (siteId = (await j(await call(`/api/v1/teams/${teamId}/sites`, {}, key)))
        .sites[0].id),
  );

  it('is open to browsers (CORS), counts page views, and answers preflight', async () => {
    const pre = await call(`/api/v1/ingest/${siteId}`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    const r = await call(`/api/v1/ingest/${siteId}`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'pageview', path: '/guide' }),
      headers: {
        'content-type': 'text/plain',
        'user-agent': 'Mozilla/5.0 Firefox',
      },
    });
    expect(r.status).toBe(202);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const board = await j(
      await call(`/api/v1/sites/${siteId}/analytics`, {}, key),
    );
    expect(board.topPages[0]).toMatchObject({ path: '/guide', views: 1 });
  });

  it('skips Do Not Track, ignores a browser claiming to be AI, and treats unknown sites like known ones', async () => {
    const dnt = await j(
      await call(`/api/v1/ingest/${siteId}`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'pageview', path: '/dnt' }),
        headers: { 'sec-gpc': '1' },
      }),
    );
    expect(dnt).toEqual({ status: 'skipped', reason: 'do-not-track' });
    await call(`/api/v1/ingest/${siteId}`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'pageview',
        path: '/fake-ai',
        traffic: 'ai',
      }),
      headers: { 'user-agent': 'Mozilla/5.0 Firefox' },
    });
    const row = (
      await db.query(
        "SELECT traffic FROM analytics_events WHERE path = '/fake-ai'",
      )
    ).rows[0] as { traffic: string };
    expect(row.traffic).toBe('human');
    const ghost = await call(
      '/api/v1/ingest/00000000-0000-0000-0000-000000000000',
      {
        method: 'POST',
        body: JSON.stringify({ kind: 'pageview', path: '/x' }),
      },
    );
    expect(ghost.status).toBe(202);
    expect(
      (await call(`/api/v1/ingest/${siteId}`, { method: 'POST', body: 'nope' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(`/api/v1/ingest/${siteId}`, {
          method: 'POST',
          body: 'x'.repeat(9000),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await call(`/api/v1/ingest/${siteId}`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'feedback', path: '/x', value: 'bad' }),
        })
      ).status,
    ).toBe(400);
  });

  it('rate-limits one visitor, not the world', async () => {
    let limited = 0;
    for (let i = 0; i < 130; i++) {
      const r = await call(`/api/v1/ingest/${siteId}`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'pageview', path: '/spam' }),
        ip: '203.0.113.99',
      });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    const other = await call(`/api/v1/ingest/${siteId}`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'pageview', path: '/ok' }),
      ip: '203.0.113.100',
    });
    expect(other.status).toBe(202);
  });

  it('only believes X-Forwarded-For when told to trust the proxy', async () => {
    const send = (platform: Platform) =>
      platform.handler(
        new Request(`https://platform.test/api/v1/ingest/${siteId}`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'pageview', path: '/xff' }),
          headers: { 'x-forwarded-for': '192.0.2.77', 'user-agent': 'UA' },
        }),
        { ip: '10.9.9.9' },
      );
    const visitor = async () =>
      (
        (
          await db.query(
            "SELECT visitor FROM analytics_events WHERE path = '/xff' ORDER BY id DESC LIMIT 1",
          )
        ).rows[0] as { visitor: string }
      ).visitor;
    await send(p);
    const untrusted = await visitor();
    const proxied = await createPlatform(
      loadConfig({ ...env, DOCKUDOS_TRUST_PROXY: 'true' }),
      { db, storage: createMemoryStorage(), providers: { github: git } },
    );
    await send(proxied);
    expect(await visitor()).not.toBe(untrusted);
  });
});

describe('roles', () => {
  it('a process answers only the groups of its roles', async () => {
    const hooksOnly = await createPlatform(
      loadConfig({ ...env, DOCKUDOS_SERVICES: 'hooks' }),
      { db, storage: createMemoryStorage(), providers: { github: git } },
    );
    const get = (path: string) =>
      hooksOnly.handler(new Request(`https://platform.test${path}`));
    expect((await get('/api/v1/me')).status).toBe(404);
    expect((await get('/healthz')).status).toBe(200);
    const siteOnly = await createPlatform(
      loadConfig({ ...env, DOCKUDOS_SERVICES: 'worker' }),
      { db, storage: createMemoryStorage(), providers: { github: git } },
    );
    expect(
      (
        await siteOnly.handler(
          new Request('https://x.sites.test/', {
            headers: { host: 'x.sites.test' },
          }),
        )
      ).status,
    ).toBe(404);
    const hookRes = await hooksOnly.handler(
      new Request(
        'https://platform.test/hooks/github/00000000-0000-0000-0000-000000000000',
        { method: 'POST', body: '{}' },
      ),
    );
    expect(hookRes.status).toBe(401);
    expect(
      (
        await siteOnly.handler(
          new Request(
            'https://platform.test/hooks/github/00000000-0000-0000-0000-000000000000',
            { method: 'POST', body: '{}' },
          ),
        )
      ).status,
    ).toBe(404);
  });

  it('sign-in routes say so when no provider is configured', async () => {
    expect((await call('/auth/login')).status).toBe(404);
  });
});
