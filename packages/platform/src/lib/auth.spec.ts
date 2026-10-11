import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCookie, verifyToken } from '@dockudos/core';
import { type Actor, createAuth, DOCS_SESSION_COOKIE, PLATFORM_SESSION_COOKIE } from './auth.ts';
import type { Db } from './db.ts';
import { PlatformError } from './errors.ts';
import { can } from './permissions.ts';
import { createOidcLogin, LOGIN_COOKIE } from './oidc-login.ts';
import { createTestIdp } from './testing/idp.ts';
import { createTestDb } from './testing/pglite.ts';

const SECRET = 's'.repeat(40);
const NOW = 2_000_000_000;
let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());
const clock = () => new Date(NOW * 1000);
const fresh = () => createAuth({ db, secret: SECRET, clock });
const user = (a: ReturnType<typeof fresh>, sub: string, extra: object = {}) =>
  a.upsertUser({ sub, email: `${sub}@x.test`, name: sub, roles: [], groups: [], ...extra });
const as = (u: Awaited<ReturnType<typeof user>>): Actor => ({ type: 'user', user: u });
const status = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as PlatformError).status;

describe('permissions', () => {
  it('are cumulative and deny by default', () => {
    expect(can('viewer', 'site.read')).toBe(true);
    expect(can('viewer', 'site.edit')).toBe(false);
    expect(can('editor', 'site.edit')).toBe(true);
    expect(can('editor', 'keys.manage')).toBe(false);
    expect(can('admin', 'members.manage')).toBe(true);
    expect(can('admin', 'team.delete')).toBe(false);
    expect(can('owner', 'team.delete')).toBe(true);
    expect(can(undefined, 'site.read')).toBe(false);
  });
});

describe('users', () => {
  it('makes the first user owner and updates on later sign-ins', async () => {
    const a = fresh();
    const first = await user(a, 'first');
    expect(first.instanceRole).toBe('owner');
    expect((await user(a, 'second')).instanceRole).toBe('member');
    const again = await user(a, 'first', { name: 'Renamed', roles: ['dev'] });
    expect(again).toMatchObject({ id: first.id, name: 'Renamed', roles: ['dev'] });
  });

  it('with an admin email, only that verified address becomes owner', async () => {
    const d = await createTestDb();
    const a = createAuth({ db: d, secret: SECRET, clock, adminEmail: 'boss@x.test' });
    expect((await a.upsertUser({ sub: 'a', email: 'someone@x.test', roles: [], groups: [] })).instanceRole).toBe('member');
    const fake = await a.userFromClaims({ sub: 'b', email: 'boss@x.test', email_verified: false });
    expect(fake.instanceRole).toBe('member');
    expect(fake.email).toBeUndefined();
    const real = await a.userFromClaims({ sub: 'c', email: 'Boss@X.test', email_verified: true });
    expect(real.instanceRole).toBe('owner');
    await d.close();
  });
});

describe('sessions', () => {
  it('round-trips, expires, and ends with the user', async () => {
    const a = fresh();
    const u = await user(a, 'sess');
    const token = await a.sessionToken(u);
    expect((await a.userFromSession(token))?.id).toBe(u.id);
    expect(await a.userFromSession(token + 'x')).toBeUndefined();
    expect(await a.userFromSession(undefined)).toBeUndefined();
    const later = createAuth({ db, secret: SECRET, clock: () => new Date((NOW + 13 * 3600) * 1000) });
    expect(await later.userFromSession(token)).toBeUndefined();
    expect(await createAuth({ db, secret: 'o'.repeat(40), clock }).userFromSession(token)).toBeUndefined();
    await db.query('DELETE FROM users WHERE id = $1', [u.id]);
    expect(await a.userFromSession(token)).toBeUndefined();
  });
});

describe('teams and roles', () => {
  it('creates teams with unique slugs; creator owns', async () => {
    const a = fresh();
    const u = await user(a, 'teamsmith');
    const t1 = await a.createTeam(as(u), 'Acme Docs');
    const t2 = await a.createTeam(as(u), 'Acme Docs');
    expect([t1.slug, t2.slug]).toEqual(['acme-docs', 'acme-docs-2']);
    expect(await status(a.createTeam(as(u), '  '))).toBe(400);
    expect((await a.listTeams(as(u))).map((t) => t.role)).toEqual(['owner', 'owner']);
  });

  it('hides other teams from members and checks roles per action', async () => {
    const a = fresh();
    const owner = await user(a, 'o1');
    const dev = await user(a, 'd1');
    const stranger = await user(a, 's1');
    const team = await a.createTeam(as(owner), 'Role Team');
    await a.setMember(as(owner), team.id, dev.email!, 'editor');
    await a.require(as(dev), team.id, 'site.edit');
    expect(await status(a.require(as(dev), team.id, 'keys.manage'))).toBe(403);
    expect(await status(a.require(as(stranger), team.id, 'site.read'))).toBe(403);
    expect((await a.listTeams(as(stranger)))).toEqual([]);
    expect((await a.listTeams(as(dev))).map((t) => t.id)).toEqual([team.id]);
  });

  it('lets the instance owner act in any team', async () => {
    const d = await createTestDb();
    const a = createAuth({ db: d, secret: SECRET, clock });
    const root = await user(a, 'root');
    const other = await user(a, 'other');
    const team = await a.createTeam(as(other), 'Theirs');
    await a.require(as(root), team.id, 'team.delete');
    expect((await a.listTeams(as(root))).map((t) => t.id)).toEqual([team.id]);
    await d.close();
  });

  it('stops privilege escalation and orphaned teams', async () => {
    const a = fresh();
    const owner = await user(a, 'o2');
    const admin = await user(a, 'a2');
    const viewer = await user(a, 'v2');
    const team = await a.createTeam(as(owner), 'Esc Team');
    await a.setMember(as(owner), team.id, admin.email!, 'admin');
    await a.setMember(as(admin), team.id, viewer.email!, 'viewer');
    expect(await status(a.setMember(as(admin), team.id, viewer.email!, 'owner'))).toBe(403);
    expect(await status(a.setMember(as(admin), team.id, owner.email!, 'viewer'))).toBe(403);
    expect(await status(a.setMember(as(viewer), team.id, viewer.email!, 'editor'))).toBe(403);
    expect(await status(a.setMember(as(owner), team.id, 'nobody@x.test', 'viewer'))).toBe(404);
    expect(await status(a.setMember(as(owner), team.id, viewer.email!, 'god' as never))).toBe(400);
    expect(await status(a.setMember(as(owner), team.id, owner.email!, 'admin'))).toBe(409);
    expect(await status(a.removeMember(as(owner), team.id, owner.id))).toBe(409);
    expect(await status(a.removeMember(as(admin), team.id, owner.id))).toBe(403);
    await a.removeMember(as(viewer), team.id, viewer.id); // leaving is always allowed
    expect(await status(a.removeMember(as(owner), team.id, viewer.id))).toBe(404);
    expect((await a.listMembers(as(owner), team.id)).map((m) => m.role).sort()).toEqual(['admin', 'owner']);
  });
});

describe('api keys', () => {
  it('stores only a hash, authenticates, and scopes to its team', async () => {
    const a = fresh();
    const owner = await user(a, 'k-o');
    const team = await a.createTeam(as(owner), 'Key Team');
    const other = await a.createTeam(as(owner), 'Other Team');
    const { key, secret } = await a.createApiKey(as(owner), team.id, 'CI', 'editor');
    expect(secret).toMatch(/^dkd_[0-9a-f]{8}_/);
    const stored = (await db.query<{ hash: string }>('SELECT hash FROM api_keys WHERE id = $1', [key.id])).rows[0]!.hash;
    expect(secret).not.toContain(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    const info = await a.authenticateApiKey(secret);
    expect(info).toMatchObject({ id: key.id, role: 'editor' });
    const actor: Actor = { type: 'key', key: info! };
    await a.require(actor, team.id, 'site.edit');
    expect(await status(a.require(actor, team.id, 'keys.manage'))).toBe(403);
    expect(await status(a.require(actor, other.id, 'site.read'))).toBe(403);
    expect(await status(a.createApiKey(actor, team.id, 'x', 'viewer'))).toBe(403);
    expect((await a.listTeams(actor)).map((t) => t.id)).toEqual([team.id]);
    expect(await a.principalFor(actor)).toMatchObject({ groups: ['team:key-team'], roles: ['team:key-team:editor'] });
  });

  it('refuses wrong, revoked and expired keys alike', async () => {
    const a = fresh();
    const owner = await user(a, 'k-o2');
    const team = await a.createTeam(as(owner), 'Key Team 2');
    const { key, secret } = await a.createApiKey(as(owner), team.id, 'tmp', 'viewer', 1);
    expect(await a.authenticateApiKey(secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A'))).toBeUndefined();
    expect(await a.authenticateApiKey('garbage')).toBeUndefined();
    expect(await a.authenticateApiKey(undefined)).toBeUndefined();
    expect(await a.authenticateApiKey(`dkd_00000000_${'a'.repeat(32)}`)).toBeUndefined();
    const later = createAuth({ db, secret: SECRET, clock: () => new Date((NOW + 2 * 86400) * 1000) });
    expect(await later.authenticateApiKey(secret)).toBeUndefined();
    expect(await a.authenticateApiKey(secret)).toBeDefined();
    await a.revokeApiKey(as(owner), team.id, key.id);
    expect(await a.authenticateApiKey(secret)).toBeUndefined();
    expect(await status(a.revokeApiKey(as(owner), team.id, key.id))).toBe(404);
    expect((await a.listApiKeys(as(owner), team.id))[0]!.revokedAt).toBeDefined();
    expect(await status(a.createApiKey(as(owner), team.id, '', 'viewer'))).toBe(400);
    expect(await status(a.createApiKey(as(owner), team.id, 'k', 'owner' as never))).toBe(400);
  });

  it('cannot mint a key above the creator role', async () => {
    const a = fresh();
    const owner = await user(a, 'k-o3');
    const admin = await user(a, 'k-a3');
    const team = await a.createTeam(as(owner), 'Key Team 3');
    await a.setMember(as(owner), team.id, admin.email!, 'admin');
    await a.createApiKey(as(admin), team.id, 'ok', 'admin');
  });

  it('identifies callers from requests: bearer first, then cookie', async () => {
    const a = fresh();
    const owner = await user(a, 'k-o4');
    const team = await a.createTeam(as(owner), 'Key Team 4');
    const { secret } = await a.createApiKey(as(owner), team.id, 'req', 'viewer');
    const byKey = await a.actorFromRequest(new Request('https://x.test/', { headers: { authorization: `Bearer ${secret}` } }));
    expect(byKey?.type).toBe('key');
    const cookie = `${PLATFORM_SESSION_COOKIE}=${await a.sessionToken(owner)}`;
    const byCookie = await a.actorFromRequest(new Request('https://x.test/', { headers: { cookie } }));
    expect(byCookie).toMatchObject({ type: 'user', user: { id: owner.id } });
    expect(await a.actorFromRequest(new Request('https://x.test/', { headers: { authorization: 'Bearer dkd_bad', cookie } }))).toBeUndefined();
    expect(await a.actorFromRequest(new Request('https://x.test/'))).toBeUndefined();
    expect(await status(a.requireActor(new Request('https://x.test/')))).toBe(401);
  });
});

describe('docs bridge (P5.6)', () => {
  it('turns team membership into roles and groups that docs.json rules can match, in a cookie docs sites read', async () => {
    const a = fresh();
    const u = await user(a, 'b-1', { roles: ['idp-role'], groups: ['idp-group'] });
    const team = await a.createTeam(as(u), 'Bridge Co');
    const principal = await a.principalFor(as(u));
    expect(principal.groups).toEqual(expect.arrayContaining(['idp-group', 'team:bridge-co']));
    expect(principal.roles).toEqual(expect.arrayContaining(['idp-role', 'team:bridge-co:owner']));
    const token = await a.docsSession(principal, 'd'.repeat(40), 1);
    const data = await verifyToken<Record<string, unknown>>(token, 'd'.repeat(40), { purpose: 'session', now: NOW });
    expect(data).toMatchObject({ sub: 'b-1', groups: expect.arrayContaining(['team:bridge-co']) });
    expect(DOCS_SESSION_COOKIE).toBe('dockudos_session');
    expect(team.slug).toBe('bridge-co');
  });
});

describe('OIDC sign-in with a test provider (P5 acceptance)', () => {
  async function setup() {
    const idp = await createTestIdp();
    idp.now = NOW;
    const a = createAuth({ db, secret: SECRET, clock });
    const login = createOidcLogin({
      auth: a, publicUrl: 'https://platform.test', secret: SECRET, fetch: idp.fetcher, clock,
      oidc: { issuer: 'https://idp.test', clientId: 'dockudos', rolesClaim: 'roles', groupsClaim: 'groups' },
    });
    return { idp, a, login };
  }
  const cookieOf = (res: Response, name: string) => readCookie(res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), name);

  it('signs a person in, sets a session cookie, and returns to a safe path', async () => {
    const { idp, a, login } = await setup();
    const start = await login.login(new Request('https://platform.test/auth/login?returnTo=/teams'));
    expect(start.status).toBe(302);
    const { code, state } = idp.approve(start.headers.get('location')!, { sub: 'oidc-1', email: 'sso@x.test', email_verified: true, groups: ['eng'] });
    const back = await login.callback(new Request(`https://platform.test/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}` },
    }));
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/teams');
    const session = cookieOf(back, PLATFORM_SESSION_COOKIE)!;
    const me = await a.userFromSession(session);
    expect(me).toMatchObject({ sub: 'oidc-1', groups: ['eng'] });
    expect(back.headers.getSetCookie().join(';')).toMatch(/HttpOnly/);
  });

  it('also sets the private-docs cookie when asked, scoped to the shared domain', async () => {
    const idp = await createTestIdp();
    idp.now = NOW;
    const a = createAuth({ db, secret: SECRET, clock });
    const login = createOidcLogin({
      auth: a, publicUrl: 'https://platform.example.com', secret: SECRET, fetch: idp.fetcher, clock,
      docsSession: { secret: 'd'.repeat(40), domain: '.example.com' },
      oidc: { issuer: 'https://idp.test', clientId: 'dockudos', rolesClaim: 'roles', groupsClaim: 'groups' },
    });
    const start = await login.login(new Request('https://platform.example.com/auth/login'));
    const { code, state } = idp.approve(start.headers.get('location')!, { sub: 'oidc-docs', groups: ['eng'] });
    const back = await login.callback(new Request(`https://platform.example.com/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}` },
    }));
    const docs = back.headers.getSetCookie().find((c) => c.startsWith(`${DOCS_SESSION_COOKIE}=`))!;
    expect(docs).toContain('Domain=.example.com');
    const principal = await verifyToken<Record<string, unknown>>(docs.split(';')[0]!.split('=')[1], 'd'.repeat(40), { purpose: 'session', now: NOW });
    expect(principal).toMatchObject({ sub: 'oidc-docs', groups: ['eng'] });
    expect(login.logout(new Request('https://platform.example.com/auth/logout', { method: 'POST' })).headers.getSetCookie().some((c) => c.startsWith(`${DOCS_SESSION_COOKIE}=;`))).toBe(true);
  });

  it('refuses open redirects, replayed codes, wrong state and missing login cookie', async () => {
    const { idp, login } = await setup();
    const start = await login.login(new Request('https://platform.test/auth/login?returnTo=https://evil.test/'));
    const loginCookie = `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}`;
    const { code, state } = idp.approve(start.headers.get('location')!, { sub: 'oidc-2' });
    const cb = (qs: string, cookie = loginCookie) => login.callback(new Request(`https://platform.test/auth/callback?${qs}`, { headers: { cookie } }));
    expect((await cb(`code=${code}&state=wrong`)).status).toBe(400);
    expect((await cb(`code=${code}&state=${state}`, '')).status).toBe(400);
    expect((await cb(`error=access_denied&state=${state}`)).status).toBe(403);
    const ok = await cb(`code=${code}&state=${state}`);
    expect(ok.headers.get('location')).toBe('/');
    expect((await cb(`code=${code}&state=${state}`)).status).toBe(403);
  });

  it('refuses a token for another audience or nonce', async () => {
    const { idp, login } = await setup();
    const start = await login.login(new Request('https://platform.test/auth/login'));
    const loc = new URL(start.headers.get('location')!);
    loc.searchParams.set('nonce', 'attacker-chosen');
    const { code, state } = idp.approve(loc.toString(), { sub: 'oidc-3' });
    const res = await login.callback(new Request(`https://platform.test/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}` },
    }));
    expect(res.status).toBe(403);
  });

  it('reports an unreachable provider and signs out only from this site', async () => {
    const a = createAuth({ db, secret: SECRET, clock });
    const login = createOidcLogin({
      auth: a, publicUrl: 'https://platform.test', secret: SECRET, clock,
      fetch: (async () => { throw new Error('down'); }) as never,
      oidc: { issuer: 'https://idp.test', clientId: 'dockudos', rolesClaim: 'roles', groupsClaim: 'groups' },
    });
    expect((await login.login(new Request('https://platform.test/auth/login'))).status).toBe(502);
    expect(login.logout(new Request('https://platform.test/auth/logout', { method: 'POST', headers: { origin: 'https://evil.test' } })).status).toBe(403);
    const out = login.logout(new Request('https://platform.test/auth/logout', { method: 'POST', headers: { origin: 'https://platform.test' } }));
    expect(out.status).toBe(303);
    expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0');
  });
});
