import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { spawnRunner } from './exec.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture, type Fixture } from './testing/platform-fixture.ts';

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

async function push(f: Fixture, sha: string, id: string) {
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    after: sha,
    repository: { full_name: f.repo },
    commits: [{ modified: ['index.mdx'] }],
  });
  return f.webhooks(
    new Request('https://p.test/', {
      method: 'POST',
      body,
      headers: {
        'x-hub-signature-256': `sha256=${createHmac('sha256', f.webhookSecret).update(body).digest('hex')}`,
        'x-github-event': 'push',
        'x-github-delivery': id,
      },
    }),
    'github',
    f.site.id,
  );
}
const text = async (r: Response) => r.text();

describe('push -> build -> artifact -> live site (P5 acceptance)', () => {
  it('goes live only after a build succeeds, and serves the new content', async () => {
    const f = await createFixture(db);
    const head = f.git.push(f.repo, 'main', { 'index.mdx': '# Changed' });
    expect((await f.builds.serve(f.site.slug, '/')).status).toBe(404);

    const res = await push(f, head, 'live-1');
    expect(res.status).toBe(202);
    const { buildId } = (await res.json()) as { buildId: string };
    expect((await f.builds.get(f.actor, buildId)).status).toBe('queued');
    expect((await f.builds.serve(f.site.slug, '/')).status).toBe(404);

    await f.drain();
    const build = await f.builds.get(f.actor, buildId);
    expect(build).toMatchObject({ status: 'succeeded', commitSha: head });
    expect(build.log).toContain('Published');
    expect(build.log).toContain('--ignore-scripts');

    const home = await f.builds.serve(f.site.slug, '/');
    expect(home.status).toBe(200);
    expect(await text(home)).toBe('<h1>Home</h1>');
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await text(await f.builds.serve(f.site.slug, '/guide'))).toBe(
      '<h1>Guide</h1>',
    );
    expect(await text(await f.builds.serve(f.site.slug, '/guide/'))).toBe(
      '<h1>Guide</h1>',
    );
    expect(await text(await f.builds.serve(f.site.slug, '/api'))).toBe(
      '<h1>API</h1>',
    );
    const asset = await f.builds.serve(f.site.slug, '/_next/static/app.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const missing = await f.builds.serve(f.site.slug, '/nope');
    expect(missing.status).toBe(404);
    expect(await text(missing)).toBe('<h1>Missing</h1>');
    expect(f.git.statuses.map((s) => s.state)).toEqual(['pending', 'success']);
    expect(await f.builds.liveIndex(f.site.id)).toMatchObject({ version: 1 });
    expect(f.metrics.render()).toContain(
      'dockudos_builds_total{outcome="succeeded"} 1',
    );
  });

  it('never stores or serves a symlink out of the build folder', async () => {
    const f = await createFixture(db);
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    expect(
      [...f.storage.objects.keys()].some((k) => k.endsWith('leak.txt')),
    ).toBe(false);
    expect((await f.builds.serve(f.site.slug, '/leak.txt')).status).toBe(404);
  });

  it('refuses path traversal when serving', async () => {
    const f = await createFixture(db);
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    for (const p of [
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/x',
      '/a/%00',
      '/%zz',
    ]) {
      const r = await f.builds.serve(f.site.slug, p);
      expect([400, 404]).toContain(r.status);
    }
  });

  it('runs install and build without the platform environment or lifecycle scripts', async () => {
    const f = await createFixture(db);
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const install = f.commands.find(
      (c) => c.args[0] === 'install' || c.args[0] === 'ci',
    )!;
    expect(install.args).toContain('--ignore-scripts');
    expect(
      f.commands.every((c) => !c.env || !('DOCKUDOS_DATABASE_URL' in c.env)),
    ).toBe(true);
  });
});

describe('failure handling', () => {
  it('marks a failing build failed, keeps the previous site live, and reports the failure', async () => {
    let fail = false;
    const f = await createFixture(db, {
      onCommand: async (_c, args) =>
        fail && args.includes('build') ? 2 : undefined,
    });
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const live = (
      await db.query<{ live_build_id: string }>(
        'SELECT live_build_id FROM sites WHERE id = $1',
        [f.site.id],
      )
    ).rows[0]!.live_build_id;
    fail = true;
    f.git.push(f.repo, 'main', { 'index.mdx': '# Broken' });
    f.clockState.now = new Date(f.clockState.now.getTime() + 60_000);
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const failed = await f.builds.get(f.actor, buildId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('failed (exit 2)');
    expect(failed.log).toContain('ERROR');
    expect(
      (
        await db.query<{ live_build_id: string }>(
          'SELECT live_build_id FROM sites WHERE id = $1',
          [f.site.id],
        )
      ).rows[0]!.live_build_id,
    ).toBe(live);
    expect(await text(await f.builds.serve(f.site.slug, '/'))).toBe(
      '<h1>Home</h1>',
    );
    expect(f.git.statuses.at(-1)!.state).toBe('failure');
    expect((await f.queue.stats())['dead']).toBeGreaterThanOrEqual(1);
  });

  it('retries a transient failure (not marked failed until attempts run out)', async () => {
    let calls = 0;
    const f = await createFixture(db, {
      onCommand: async (_c, args) =>
        args.includes('build') && ++calls === 1
          ? (() => {
              throw new Error('network blip');
            })()
          : undefined,
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.worker.runOnce();
    expect((await f.builds.get(f.actor, buildId)).status).toBe('running');
    f.clockState.now = new Date(f.clockState.now.getTime() + 60_000);
    await f.drain();
    expect((await f.builds.get(f.actor, buildId)).status).toBe('succeeded');
  });

  it('scrubs secrets out of the build log and the recorded error', async () => {
    const f = await createFixture(db, {
      secrets: ['ghp_SUPERSECRETTOKEN'],
      onCommand: async (_c, args, _cwd, out) => {
        if (!args.includes('build')) return undefined;
        out?.(
          'remote: https://x-access-token:ghp_SUPERSECRETTOKEN@github.com/acme/docs\n',
        );
        throw new Error('fetch failed for ghp_SUPERSECRETTOKEN');
      },
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.worker.runOnce();
    const build = await f.builds.get(f.actor, buildId);
    expect(build.log).toContain('[redacted]');
    expect(build.log).not.toContain('SUPERSECRETTOKEN');
    expect(JSON.stringify(build)).not.toContain('SUPERSECRETTOKEN');
  });

  it('fails permanently, without retrying, when the docs folder is missing or no index.html is produced', async () => {
    const f = await createFixture(db, { files: { 'out/other.html': 'x' } });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    expect((await f.builds.get(f.actor, buildId)).error).toContain(
      'no out/index.html',
    );
    await db.query("UPDATE sites SET docs_dir = 'missing' WHERE id = $1", [
      f.site.id,
    ]);
    f.clockState.now = new Date(f.clockState.now.getTime() + 1000);
    const second = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    expect((await f.builds.get(f.actor, second.buildId)).error).toContain(
      'does not exist',
    );
  });

  it('does not let an older build that finishes late replace a newer live one', async () => {
    const f = await createFixture(db);
    const older = await f.builds.rebuild(f.actor, f.site.id);
    f.clockState.now = new Date(f.clockState.now.getTime() + 60_000);
    f.git.push(f.repo, 'main', { 'x.mdx': 'y' });
    const newer = await f.builds.rebuild(f.actor, f.site.id);
    // The newer build is claimed and finished first.
    await db.query(
      "UPDATE jobs SET run_at = run_at - interval '1 hour' WHERE idempotency_key = $1",
      [newer.buildId],
    );
    await f.worker.runOnce();
    await f.worker.runOnce();
    const live = (
      await db.query<{ live_build_id: string }>(
        'SELECT live_build_id FROM sites WHERE id = $1',
        [f.site.id],
      )
    ).rows[0]!.live_build_id;
    expect(live).toBe(newer.buildId);
    expect((await f.builds.get(f.actor, older.buildId)).status).toBe(
      'succeeded',
    );
  });
});

describe('history and cleanup', () => {
  it('requires access to see builds, and keeps only the newest ones', async () => {
    const f = await createFixture(db);
    const stranger = await f.auth.upsertUser({
      sub: `st-${Math.random()}`,
      email: `st${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    await expect(
      f.builds.get({ type: 'user', user: stranger }, buildId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.builds.list({ type: 'user', user: stranger }, f.site.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.builds.get(f.actor, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 4; i++) {
      f.clockState.now = new Date(f.clockState.now.getTime() + 60_000);
      f.git.push(f.repo, 'main', { [`p${i}.mdx`]: 'x' });
      await f.builds.rebuild(f.actor, f.site.id);
      await f.drain();
    }
    expect((await f.builds.list(f.actor, f.site.id)).length).toBe(5);
    expect(await f.builds.gc(f.site.id, 2)).toBe(2);
    const oldest = (await f.builds.list(f.actor, f.site.id)).at(-1)!;
    expect((await f.storage.list(`builds/${oldest.id}/`)).length).toBe(0);
    expect(await text(await f.builds.serve(f.site.slug, '/'))).toBe(
      '<h1>Home</h1>',
    );
  });
});

describe('command runner', () => {
  it('captures output, passes only a minimal environment, and enforces the timeout', async () => {
    process.env['DOCKUDOS_DATABASE_URL'] = 'postgres://leak';
    let out = '';
    const ok = await spawnRunner({
      cmd: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify(Object.keys(process.env).sort()))',
      ],
      cwd: process.cwd(),
      onOutput: (c) => (out += c),
    });
    expect(ok.code).toBe(0);
    expect(out).not.toContain('DOCKUDOS_DATABASE_URL');
    expect(out).toContain('PATH');
    let killed = '';
    const slow = await spawnRunner({
      cmd: process.execPath,
      args: ['-e', 'setTimeout(()=>{}, 60000)'],
      cwd: process.cwd(),
      timeoutMs: 200,
      onOutput: (c) => (killed += c),
    });
    expect(slow.code).not.toBe(0);
    expect(killed).toContain('killed');
    const ac = new AbortController();
    const aborted = spawnRunner({
      cmd: process.execPath,
      args: ['-e', 'setTimeout(()=>{}, 60000)'],
      cwd: process.cwd(),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    expect((await aborted).code).not.toBe(0);
    await expect(
      spawnRunner({
        cmd: 'definitely-not-a-command',
        args: [],
        cwd: process.cwd(),
      }),
    ).rejects.toThrow();
    delete process.env['DOCKUDOS_DATABASE_URL'];
  });
});
