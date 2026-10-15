import { mkdir, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

const status = async (
  f: Awaited<ReturnType<typeof createFixture>>,
  id: string,
) => f.builds.get(f.actor, id);

describe('package manager detection', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm', ['install', '--frozen-lockfile']],
    ['yarn.lock', 'yarn', ['install', '--frozen-lockfile']],
    ['package-lock.json', 'npm', ['ci']],
  ])(
    'uses the lockfile %s -> %s, never running lifecycle scripts',
    async (lock, cmd, start) => {
      const f = await createFixture(db);
      f.git.push(f.repo, 'main', { [lock]: 'x' });
      await f.builds.rebuild(f.actor, f.site.id);
      await f.drain();
      const install = f.commands[0]!;
      expect(install.cmd).toBe(cmd);
      expect(install.args.slice(0, start.length)).toEqual(start);
      expect(install.args).toContain('--ignore-scripts');
    },
  );

  it('falls back to npm install without a lockfile', async () => {
    const f = await createFixture(db);
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    expect(f.commands[0]).toMatchObject({ cmd: 'npm' });
    expect(f.commands[0]!.args[0]).toBe('install');
  });
});

describe('build log', () => {
  it('persists long output in chunks and keeps every line', async () => {
    const f = await createFixture(db, {
      onCommand: async (_c, args, _cwd, out) => {
        if (!args.includes('build')) return undefined;
        for (let i = 0; i < 5; i++) out?.(`line-${i} ${'x'.repeat(900)}\n`);
        return undefined;
      },
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const build = await status(f, buildId);
    expect(build.status).toBe('succeeded');
    for (let i = 0; i < 5; i++) expect(build.log).toContain(`line-${i} `);
  });
});

describe('upload limits', () => {
  it('rejects a site with too many files, permanently', async () => {
    const f = await createFixture(db, {
      onCommand: async (_c, args, cwd) => {
        if (!args.includes('build')) return undefined;
        const dir = join(cwd, 'out', 'many');
        await mkdir(dir, { recursive: true });
        await Promise.all(
          Array.from({ length: 20_001 }, (_, i) =>
            writeFile(join(dir, `f${i}.txt`), ''),
          ),
        );
        return undefined;
      },
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const build = await status(f, buildId);
    expect(build.status).toBe('failed');
    expect(build.error).toContain('more than 20000 files');
    // Non-retryable: it died on the first attempt instead of being queued again.
    expect((await f.queue.stats())['dead']).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('rejects a site over 500 MB without reading the file', async () => {
    const f = await createFixture(db, {
      onCommand: async (_c, args, cwd) => {
        if (!args.includes('build')) return undefined;
        const big = join(cwd, 'out', 'big.bin');
        await mkdir(join(cwd, 'out'), { recursive: true });
        await writeFile(big, '');
        await truncate(big, 501 * 1024 * 1024); // sparse: no disk used
        return undefined;
      },
    });
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const build = await status(f, buildId);
    expect(build.status).toBe('failed');
    expect(build.error).toContain('larger than 500 MB');
  });
});

describe('the build job guards', () => {
  const job = (buildId: string) => ({
    id: 'j',
    queue: 'build',
    payload: { buildId },
    attempts: 1,
    maxAttempts: 3,
  });
  const ctx = () => ({
    log: { child: () => ({}) } as never,
    signal: new AbortController().signal,
  });

  it('refuses a build that no longer exists', async () => {
    const f = await createFixture(db);
    await expect(
      f.builds.handle(
        job('00000000-0000-0000-0000-000000000000') as never,
        ctx(),
      ),
    ).rejects.toThrow('no longer exists');
  });

  it('does nothing when the build already succeeded (idempotent)', async () => {
    const f = await createFixture(db);
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const before = f.commands.length;
    await f.builds.handle(job(buildId) as never, ctx());
    expect(f.commands.length).toBe(before);
  });

  it('cascades: deleting a site removes its builds', async () => {
    const f = await createFixture(db);
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await db.query('DELETE FROM sites WHERE id = $1', [f.site.id]);
    await expect(f.builds.handle(job(buildId) as never, ctx())).rejects.toThrow(
      'The build no longer exists',
    );
  });

  it('fails permanently when the site vanishes between claiming and building (a race)', async () => {
    const f = await createFixture(db);
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    f.sites.internal = async () => {
      throw new Error('gone');
    };
    await expect(f.builds.handle(job(buildId) as never, ctx())).rejects.toThrow(
      'The site no longer exists',
    );
  });

  it('fails permanently when the Git provider is not configured', async () => {
    const f = await createFixture(db);
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    delete (f.providers as Record<string, unknown>)['github'];
    await expect(f.builds.handle(job(buildId) as never, ctx())).rejects.toThrow(
      'not configured',
    );
  });

  it('refuses a manual rebuild without a configured provider', async () => {
    const f = await createFixture(db);
    delete (f.providers as Record<string, unknown>)['github'];
    await expect(f.builds.rebuild(f.actor, f.site.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reports a failing status call without failing the build', async () => {
    const f = await createFixture(db);
    f.git.reportStatus = async () => {
      throw new Error('GitHub is down');
    };
    const { buildId } = await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    expect((await status(f, buildId)).status).toBe('succeeded');
  });
});

describe('serving', () => {
  it('has no index before a build is live', async () => {
    const f = await createFixture(db);
    expect(await f.builds.liveIndex(f.site.id)).toBeUndefined();
    expect((await f.builds.serve('no-such-site', '/')).status).toBe(404);
  });

  it('treats a storage read error for a candidate as a miss and falls back to 404.html', async () => {
    const f = await createFixture(db);
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const get = f.storage.get.bind(f.storage);
    f.storage.get = async (key: string) => {
      if (key.endsWith('flaky.html')) throw new Error('disk error');
      return get(key);
    };
    const res = await f.builds.serve(f.site.slug, '/flaky');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('<h1>Missing</h1>');
  });

  it('answers 404 text when the build has no 404.html', async () => {
    const f = await createFixture(db, {
      files: { 'out/index.html': '<h1>Home</h1>' },
    });
    await f.builds.rebuild(f.actor, f.site.id);
    await f.drain();
    const res = await f.builds.serve(f.site.slug, '/missing');
    expect(res.status).toBe(404);
  });
});
