import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockLLM } from '@dockudos/core';
import { loadConfig } from './config.ts';
import type { Db } from './db.ts';
import { createMemoryGit } from './git/memory.ts';
import { createPlatform, type Platform } from './runtime.ts';
import { createMemoryStorage } from './storage.ts';
import { createTestDb } from './testing/pglite.ts';
import { createTestIdp } from './testing/idp.ts';
import { createWorker } from './queue.ts';
import { apiSource } from './sources.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const env = {
  DOCKUDOS_DATABASE_URL: 'postgres://u:pw-secret-123@db/x', DOCKUDOS_PUBLIC_URL: 'https://platform.test', DOCKUDOS_DATA_DIR: join(tmpdir(), 'dkd-routes'),
  DOCKUDOS_SESSION_SECRET: 's'.repeat(40), DOCKUDOS_OIDC_ISSUER: 'https://idp.test', DOCKUDOS_OIDC_CLIENT_ID: 'dockudos', DOCKUDOS_DOCS_AUTH_SECRET: 'd'.repeat(40),
};
let db: Db;
let p: Platform;
let git: ReturnType<typeof createMemoryGit>;
let idp: Awaited<ReturnType<typeof createTestIdp>>;
let key: string;
let teamId: string;
let siteId: string;
const call = (path: string, method = 'GET', body?: unknown, as: string = key, extra: Record<string, string> = {}) =>
  p.handler(new Request(`https://platform.test${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }), headers: { ...(as && { authorization: `Bearer ${as}` }), ...extra } }), { ip: '198.51.100.9' });
const j = async (r: Response) => (await r.json()) as any;

beforeAll(async () => {
  db = await createTestDb();
  git = createMemoryGit('github');
  idp = await createTestIdp();
  const llm = mockLLM(() => 'DECISION: NO_CHANGE\nRATIONALE: fine');
  p = await createPlatform(loadConfig(env), {
    db, storage: createMemoryStorage(), providers: { github: git }, llm, fetch: idp.fetcher, source: apiSource,
    run: async ({ args, cwd }) => { if (args.includes('build')) { await mkdir(join(cwd, 'out'), { recursive: true }); await writeFile(join(cwd, 'out/index.html'), 'ok'); } return { code: 0 }; },
  });
  const owner = await p.auth.upsertUser({ sub: 'routes-owner', email: 'routes@x.test', roles: [], groups: [] });
  const actor = { type: 'user', user: owner } as const;
  teamId = (await p.auth.createTeam(actor, 'Routes')).id;
  key = (await p.auth.createApiKey(actor, teamId, 'admin', 'admin')).secret;
  git.seed('acme/routes', { 'docs.json': JSON.stringify({ name: 'R', navigation: [{ tab: 'Docs', groups: [{ group: 'G', pages: ['index'] }] }] }), 'docs/index.mdx': '---\ntitle: Home\n---\n\n# Home\n' });
  siteId = (await j(await call(`/api/v1/teams/${teamId}/sites`, 'POST', { name: 'Routes', provider: 'github', repo: 'acme/routes' }))).site.id;
});
afterAll(() => db.close());

describe('team routes', () => {
  it('manages members and keys', async () => {
    const other = await p.auth.upsertUser({ sub: 'routes-other', email: 'other@x.test', roles: [], groups: [] });
    expect((await call(`/api/v1/teams/${teamId}/members`, 'PUT', { email: 'other@x.test', role: 'editor' })).status).toBe(200);
    expect((await j(await call(`/api/v1/teams/${teamId}/members`))).members.map((m: any) => m.role).sort()).toEqual(['editor', 'owner']);
    expect((await call(`/api/v1/teams/${teamId}/members/${other.id}`, 'DELETE')).status).toBe(200);
    expect((await call(`/api/v1/teams/${teamId}/keys`, 'POST', { name: 'nope', role: 'viewer' })).status).toBe(403); // a key cannot mint keys
    const owner = await p.auth.upsertUser({ sub: 'routes-owner', email: 'routes@x.test', roles: [], groups: [] });
    const cookie = `dockudos_platform=${await p.auth.sessionToken(owner)}`;
    const made = await j(await call(`/api/v1/teams/${teamId}/keys`, 'POST', { name: 'temp', role: 'viewer', expiresInDays: 1 }, '', { cookie, origin: 'https://platform.test' }));
    expect(made.secret).toMatch(/^dkd_/);
    expect((await j(await call(`/api/v1/teams/${teamId}/keys`))).keys.length).toBeGreaterThanOrEqual(2);
    expect((await call(`/api/v1/teams/${teamId}/keys/${made.key.id}`, 'DELETE')).status).toBe(200);
  });
});

describe('site routes', () => {
  it('shows, rebuilds, rotates the secret and lists builds', async () => {
    const one = await j(await call(`/api/v1/sites/${siteId}`));
    expect(one.webhookUrl).toBe(`https://platform.test/hooks/github/${siteId}`);
    expect(one.url).toBeUndefined();
    const { buildId } = await j(await call(`/api/v1/sites/${siteId}/builds`, 'POST'));
    const w = createWorker({ queue: p.queue, handlers: { build: p.builds.handle } });
    while (await w.runOnce());
    expect((await j(await call(`/api/v1/builds/${buildId}`))).build.status).toBe('succeeded');
    expect((await j(await call(`/api/v1/sites/${siteId}/webhook-secret`, 'POST'))).webhookSecret).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe('editor routes', () => {
  it('reads a file, plans a page and saves it as a pull request', async () => {
    const tree = await j(await call(`/api/v1/sites/${siteId}/files`));
    const file = await j(await call(`/api/v1/sites/${siteId}/file?path=docs/index.mdx&ref=${tree.headSha}`));
    expect(file.content).toContain('# Home');
    const plan = await j(await call(`/api/v1/sites/${siteId}/pages`, 'POST', { type: 'create', id: 'new-page', title: 'New page' }));
    const saved = await j(await call(`/api/v1/sites/${siteId}/save`, 'POST', { baseSha: tree.headSha, message: 'Add page', changes: plan.changes }));
    expect(saved.prUrl).toContain('/pull/');
    expect((await call(`/api/v1/sites/${siteId}/save`, 'POST', { baseSha: tree.headSha, message: '', changes: [] })).status).toBe(400);
  });
});

describe('analytics and agent routes', () => {
  it('reads and changes analytics settings', async () => {
    expect(await j(await call(`/api/v1/sites/${siteId}/analytics/settings`))).toMatchObject({ logConversations: false });
    expect((await call(`/api/v1/sites/${siteId}/analytics/settings`, 'PUT', { logConversations: true, conversationRetentionDays: 7 })).status).toBe(200);
    expect(await j(await call(`/api/v1/sites/${siteId}/analytics/settings`))).toMatchObject({ logConversations: true, conversationRetentionDays: 7 });
  });

  it('configures the agent, schedules an automation, triggers a run and lists runs', async () => {
    expect(await j(await call(`/api/v1/sites/${siteId}/agent`))).toMatchObject({ enabled: false, modelConfigured: false });
    expect((await call(`/api/v1/sites/${siteId}/agent/trigger`, 'POST', { kind: 'broken-links' })).status).toBe(400);
    expect((await call(`/api/v1/sites/${siteId}/agent`, 'PUT', { enabled: true, codeRepos: [] })).status).toBe(200);
    expect((await call(`/api/v1/sites/${siteId}/agent/automations/broken-links`, 'PUT', { enabled: true, intervalHours: 24 })).status).toBe(200);
    expect((await call(`/api/v1/sites/${siteId}/agent/trigger`, 'POST', { kind: 'broken-links' })).status).toBe(202);
    const w = createWorker({ queue: p.queue, handlers: { agent: p.agent.handle } });
    while (await w.runOnce());
    expect((await j(await call(`/api/v1/sites/${siteId}/agent/runs`))).runs[0]).toMatchObject({ trigger: 'broken-links' });
  });
});

describe('sign-in routes', () => {
  it('redirects to the provider, completes the flow, and the cookie works against the API (with CSRF protection)', async () => {
    idp.now = Math.floor(Date.now() / 1000);
    const start = await call('/auth/login?returnTo=/dashboard', 'GET', undefined, undefined);
    expect(start.status).toBe(302);
    const loginCookie = start.headers.getSetCookie()[0]!.split(';')[0]!;
    const { code, state } = idp.approve(start.headers.get('location')!, { sub: 'sso-user', email: 'sso@x.test', email_verified: true, groups: ['eng'] });
    const back = await call(`/auth/callback?code=${code}&state=${state}`, 'GET', undefined, '', { cookie: loginCookie });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/dashboard');
    const cookies = back.headers.getSetCookie().map((c) => c.split(';')[0]!);
    expect(cookies.some((c) => c.startsWith('dockudos_session='))).toBe(true);
    const session = cookies.find((c) => c.startsWith('dockudos_platform='))!;
    const me = await j(await call('/api/v1/me', 'GET', undefined, '', { cookie: session }));
    expect(me.user.email).toBe('sso@x.test');
    expect(me.teams).toEqual([]);
    const out = await call('/auth/logout', 'POST', undefined, '', { origin: 'https://platform.test' });
    expect(out.status).toBe(303);
  });

  it('throttles repeated bad API keys from one address', async () => {
    let limited = false;
    for (let i = 0; i < 40; i++) if ((await call('/api/v1/me', 'GET', undefined, `dkd_${'0'.repeat(8)}_${'x'.repeat(40)}`)).status === 429) limited = true;
    expect(limited).toBe(true);
  });
});
