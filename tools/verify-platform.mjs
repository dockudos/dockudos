#!/usr/bin/env node
// Process-level smoke test of the platform, the way an operator would meet it.
//
//   node tools/verify-platform.mjs                       starts a Postgres (PGlite over its wire protocol) and the server from
//                                                        a pruned `pnpm deploy` of packages/platform, then checks everything
//   node tools/verify-platform.mjs --url http://localhost:8080 --api-key dkd_... [--github-repo acme/docs]
//                                                        checks a running stack (Docker Compose, Helm) instead
//
// Checks: readiness, an API key, a site connected through the Git provider, a signed webhook (and a forged one), a page view
// counted with no personal data, and the dashboard reading it back.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockGitHub } from './mock-github.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const remote = flag('url');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failures++; };
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const until = async (fn, ms = 60_000) => { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 300)); } };

const cleanup = [];
let base = remote;
let key = flag('api-key');
let githubRepo = flag('github-repo') ?? 'acme/docs';
let local = { }; // filled in local mode: how to run the server binary against other databases

if (!remote) {
  const root = new URL('..', import.meta.url).pathname;
  const work = mkdtempSync(join(tmpdir(), 'dkd-verify-'));
  cleanup.push(() => rmSync(work, { recursive: true, force: true }));
  const deploy = join(work, 'deploy');
  console.log('preparing a production tree (pnpm deploy)...');
  const r = spawnSync('pnpm', ['--filter', '@dockudos/platform', 'deploy', '--prod', deploy], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(2); }

  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const lite = await PGlite.create();
  const dbPort = await freePort();
  const pgServer = new PGLiteSocketServer({ db: lite, port: dbPort, host: '127.0.0.1' });
  await pgServer.start();
  cleanup.push(async () => { await pgServer.stop(); await lite.close(); });

  const gh = await startMockGitHub(0, { repo: githubRepo });
  cleanup.push(() => gh.server.close());
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = {
    PATH: process.env.PATH, HOME: work,
    DOCKUDOS_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres`, DOCKUDOS_PUBLIC_URL: base, DOCKUDOS_PORT: String(port),
    DOCKUDOS_SESSION_SECRET: 'verify-session-secret-0123456789abcdef-0123', DOCKUDOS_DATA_DIR: join(work, 'data'),
    DOCKUDOS_GITHUB_API_URL: `http://127.0.0.1:${gh.port}`, DOCKUDOS_GITHUB_TOKEN: 'ghp_verify_token_123456', DOCKUDOS_LOG_LEVEL: 'warn',
    // The test database accepts one connection; a pool of one also proves nothing waits on a second connection inside a transaction.
    DOCKUDOS_DB_POOL_MAX: '1', DOCKUDOS_WORKER_CONCURRENCY: '1',
  };
  // Asynchronous on purpose: this process also hosts the database the children talk to.
  const run = (a, e = env) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['dist/server.js', ...a], { cwd: deploy, env: e });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
    c.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
  const node = (a) => run(a);
  Object.assign(local, { run, env, deploy, work, newDatabase: async () => { const l = await PGlite.create(); const p = await freePort(); const sv = new PGLiteSocketServer({ db: l, port: p, host: '127.0.0.1' }); await sv.start(); cleanup.push(async () => { await sv.stop(); await l.close(); }); return p; } });
  const bad = await node(['nonsense']);
  check('unknown command is refused', bad.status === 64, bad.stderr);
  const boot = await node(['bootstrap', 'Smoke Team']);
  check('bootstrap prints an API key', boot.status === 0 && /dkd_/.test(boot.stdout), boot.stderr);
  key = JSON.parse(boot.stdout.trim().split('\n').at(-1)).apiKey;
  const noConfig = await run([], { PATH: process.env.PATH });
  check('missing configuration stops the server with a clear message (exit 78)', noConfig.status === 78 && /DOCKUDOS_DATABASE_URL/.test(noConfig.stderr), noConfig.stderr);
  const child = spawn(process.execPath, ['dist/server.js'], { cwd: deploy, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const stopMain = () => new Promise((res) => { if (child.exitCode !== null) return res(); child.once('exit', res); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); });
  cleanup.push(stopMain);
  local.stopMain = stopMain;
}

const j = async (r) => r.json().catch(() => ({}));
const api = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers } });

try {
  await until(async () => (await fetch(`${base}/readyz`)).ok);
  check('readiness reports the database and storage', true);
  const live = await fetch(`${base}/healthz`);
  check('liveness answers', live.ok);
  check('sign-in is reported as not configured, not as an error page', (await fetch(`${base}/auth/login`)).status === 404);
  check('unauthenticated API calls are refused', (await fetch(`${base}/api/v1/me`)).status === 401);
  const me = await j(await api('/api/v1/me'));
  check('the API key identifies a team', me.type === 'key' && me.teams?.length === 1, JSON.stringify(me));
  const teamId = me.teams?.[0]?.id;

  const created = await api(`/api/v1/teams/${teamId}/sites`, { method: 'POST', body: JSON.stringify({ name: 'Smoke Docs', provider: 'github', repo: githubRepo }) });
  const site = await j(created);
  check('a repository can be connected through the Git provider', created.status === 201 && site.webhookSecret, JSON.stringify(site));

  const payload = JSON.stringify({ ref: 'refs/heads/main', after: 'a'.repeat(40), repository: { full_name: githubRepo }, commits: [{ modified: ['docs/index.mdx'] }] });
  const hook = (secret, id) => fetch(site.webhookUrl.replace(/^https?:\/\/[^/]+/, base), {
    method: 'POST', body: payload,
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`, 'x-github-event': 'push', 'x-github-delivery': id },
  });
  check('a forged webhook is rejected', (await hook('wrong-secret', 'f1')).status === 401);
  check('a signed webhook queues a build', (await hook(site.webhookSecret, 'v1')).status === 202);
  check('the same delivery again is a no-op', (await j(await hook(site.webhookSecret, 'v1'))).status === 'duplicate');
  const builds = await until(async () => { const b = (await j(await api(`/api/v1/sites/${site.site.id}/builds`))).builds; return b?.length ? b : undefined; });
  check('the build is recorded', builds.length === 1 && builds[0].trigger === 'push');
  // A worker picks it up; with no reachable repository it ends in a clear failure rather than hanging.
  const settled = await until(async () => { const b = (await j(await api(`/api/v1/sites/${site.site.id}/builds`))).builds[0]; return ['failed', 'succeeded'].includes(b.status) ? b : undefined; }, 90_000).catch(() => undefined);
  check('a worker processed the build (finished or failed with a reason)', !!settled && (settled.status === "succeeded" || !!settled.error), JSON.stringify(settled));

  const ing = await fetch(`${base}/api/v1/ingest/${site.site.id}`, { method: 'POST', body: JSON.stringify({ kind: 'pageview', path: '/guide?token=secret' }), headers: { 'user-agent': 'Mozilla/5.0 Firefox/130 SmokeTest', 'x-forwarded-for': '203.0.113.9' } });
  check('a page view is accepted without a cookie', ing.status === 202 && !ing.headers.get('set-cookie'));
  const board = await j(await api(`/api/v1/sites/${site.site.id}/analytics`));
  check('the dashboard reads it back', board.topPages?.[0]?.path === '/guide', JSON.stringify(board.topPages));
  check('and stores no query string, address or agent', !JSON.stringify(board).match(/203\.0\.113|Firefox|token=/));

  const metrics = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${process.env.DOCKUDOS_METRICS_TOKEN ?? ''}` } });
  check('metrics are served (or protected by a token)', metrics.status === 200 || metrics.status === 401);

  if (local.run) {
    // The test database accepts a single connection, so stop the server first: a cold backup, which is a valid way to do it too.
    await local.stopMain();
    // Backup, then restore into a second, empty database, and prove the copy works with the same credentials.
    const dir = join(local.work, 'backup');
    const b = await local.run(['backup', dir]);
    check('backup writes a directory', b.status === 0 && JSON.parse(b.stdout.trim().split('\n').at(-1)).backup === 'ok', b.stderr);
    const db2 = await local.newDatabase();
    const port2 = await freePort();
    const env2 = { ...local.env, DOCKUDOS_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${db2}/postgres`, DOCKUDOS_PORT: String(port2), DOCKUDOS_PUBLIC_URL: `http://127.0.0.1:${port2}`, DOCKUDOS_DATA_DIR: join(local.work, 'data2') };
    const r = await local.run(['restore', dir], env2);
    check('restore loads it into a new, empty instance', r.status === 0 && JSON.parse(r.stdout.trim().split('\n').at(-1)).restore === 'ok', r.stderr);
    const again = await local.run(['restore', dir], env2);
    check('restoring over existing data is refused', again.status !== 0 && /already has data/.test(again.stderr + again.stdout), again.stderr);
    const second = spawn(process.execPath, ['dist/server.js'], { cwd: local.deploy, env: env2, stdio: ['ignore', 'inherit', 'inherit'] });
    cleanup.push(() => new Promise((res) => { second.once('exit', res); second.kill('SIGTERM'); setTimeout(() => second.kill('SIGKILL'), 5000); }));
    await until(async () => (await fetch(`http://127.0.0.1:${port2}/readyz`)).ok);
    const restored = await fetch(`http://127.0.0.1:${port2}/api/v1/teams/${teamId}/sites`, { headers: { authorization: `Bearer ${key}` } });
    const list = await j(restored);
    check('the same API key works on the restored instance and lists the site', restored.status === 200 && list.sites?.[0]?.id === site.site.id, JSON.stringify(list));
    const board2 = await j(await fetch(`http://127.0.0.1:${port2}/api/v1/sites/${site.site.id}/analytics`, { headers: { authorization: `Bearer ${key}` } }));
    check('and its analytics came across', board2.topPages?.[0]?.path === '/guide');
  }
} catch (error) {
  check('smoke test ran to the end', false, String(error));
} finally {
  for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => undefined);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
