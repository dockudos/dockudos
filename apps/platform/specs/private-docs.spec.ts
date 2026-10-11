// @vitest-environment node
// The platform and a docs site, wired the way the "Teams and sign-in" guide says: the site's access guard asks the platform who
// the caller is, and a rule names a team. This is the acceptance check "role restrictions apply to private docs".
import { createAccessProxy, createPlatformVerify } from '@dockudos/next/access';
import { PGlite } from '@electric-sql/pglite';
import {
  createPlatform,
  loadConfig,
  migrate,
  createMemoryGit,
  createMemoryStorage,
  type Platform,
} from '@dockudos/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let lite: PGlite;
let platform: Platform;
let acmeKey: string;
let otherKey: string;
let acmeCookie: string;

const wrap = (q: Pick<PGlite, 'query' | 'exec'>) => ({
  async query(sql: string, params?: unknown[]) {
    const r = await q.query(sql, params);
    return {
      rows: r.rows as never[],
      rowCount: r.rows.length || (r.affectedRows ?? 0),
    };
  },
  async exec(sql: string) {
    await q.exec(sql);
  },
});

beforeAll(async () => {
  lite = await PGlite.create();
  const db = {
    ...wrap(lite),
    transaction: <T>(fn: (tx: ReturnType<typeof wrap>) => Promise<T>) =>
      lite.transaction((tx) => fn(wrap(tx))),
    close: () => lite.close(),
  };
  platform = await createPlatform(
    loadConfig({
      DOCKUDOS_DATABASE_URL: 'postgres://u@h/d',
      DOCKUDOS_PUBLIC_URL: 'https://platform.test',
      DOCKUDOS_SESSION_SECRET: 's'.repeat(40),
      DOCKUDOS_LOG_LEVEL: 'silent',
    }),
    {
      db: db as never,
      storage: createMemoryStorage(),
      providers: { github: createMemoryGit('github') },
    },
  );
  await migrate(db as never);
  const acme = await platform.auth.upsertUser({
    sub: 'u-acme',
    email: 'a@acme.test',
    roles: [],
    groups: [],
  });
  const outsider = await platform.auth.upsertUser({
    sub: 'u-out',
    email: 'o@other.test',
    roles: [],
    groups: [],
  });
  const acmeTeam = await platform.auth.createTeam(
    { type: 'user', user: acme },
    'Acme',
  );
  const otherTeam = await platform.auth.createTeam(
    { type: 'user', user: outsider },
    'Other Co',
  );
  acmeKey = (
    await platform.auth.createApiKey(
      { type: 'user', user: acme },
      acmeTeam.id,
      'docs reader',
      'viewer',
    )
  ).secret;
  otherKey = (
    await platform.auth.createApiKey(
      { type: 'user', user: outsider },
      otherTeam.id,
      'other',
      'viewer',
    )
  ).secret;
  acmeCookie = `dockudos_platform=${await platform.auth.sessionToken(acme)}`;
});
afterAll(() => lite.close());

/** The docs site's guard, with the platform one function call away (a real deployment makes an HTTP request). */
const guard = () =>
  createAccessProxy({
    rules: [
      { paths: ['/internal/**'], require: 'custom', groups: ['team:acme'] },
      { paths: ['/admin/**'], require: 'custom', roles: ['team:acme:admin'] },
    ] as never,
    verify: createPlatformVerify({
      platformUrl: 'https://platform.test',
      cacheSeconds: 0,
      fetch: ((url: string | URL, init?: RequestInit) =>
        platform.handler(new Request(url, init))) as typeof fetch,
    }),
  });
const visit = (path: string, headers: Record<string, string> = {}) =>
  guard()(new Request(`https://docs.test${path}`, { headers }));

describe('private docs behind the platform', () => {
  it('lets a member of the named team in, with an API key or with the platform session', async () => {
    for (const headers of [
      { authorization: `Bearer ${acmeKey}` },
      { cookie: acmeCookie },
    ]) {
      const res = await visit('/internal/roadmap', headers);
      // Passed through, and marked so no CDN or search engine keeps a copy to hand to someone else.
      expect(res?.headers.get('x-middleware-next')).toBe('1');
      expect(res?.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('refuses another team, an unknown key and no credentials', async () => {
    for (const headers of [
      { authorization: `Bearer ${otherKey}` },
      { authorization: 'Bearer dkd_00000000_' + 'x'.repeat(32) },
      {},
    ]) {
      const res = await visit('/internal/roadmap', headers);
      expect(res, JSON.stringify(headers)).toBeInstanceOf(Response);
      expect([401, 403]).toContain(res!.status);
    }
  });

  it('applies a role rule: a viewer of the team is not an admin', async () => {
    const res = await visit('/admin/settings', {
      authorization: `Bearer ${acmeKey}`,
    });
    expect(res!.status).toBe(403);
    // The team owner signed in with a session holds role team:acme:owner, not admin: roles are exact, so this rule asks for the exact one.
    expect(
      (await visit('/admin/settings', { cookie: acmeCookie }))!.status,
    ).toBe(403);
  });

  it('leaves open pages open, and fails closed when the platform is down', async () => {
    expect(await visit('/guides/intro')).toBeUndefined();
    const down = createAccessProxy({
      rules: [
        { paths: ['/internal/**'], require: 'custom', groups: ['team:acme'] },
      ] as never,
      verify: createPlatformVerify({
        platformUrl: 'https://platform.test',
        cacheSeconds: 0,
        fetch: (async () => {
          throw new Error('ECONNREFUSED');
        }) as typeof fetch,
      }),
    });
    const res = await down(
      new Request('https://docs.test/internal/x', {
        headers: { authorization: `Bearer ${acmeKey}` },
      }),
    );
    expect(res!.status).toBe(403);
  });
});
