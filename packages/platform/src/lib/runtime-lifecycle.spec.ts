import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import type { Db } from './db.ts';
import { createLogger } from './logger.ts';
import { createMemoryGit } from './git/memory.ts';
import { createPlatform } from './runtime.ts';
import { createMemoryStorage } from './storage.ts';
import { createTestDb } from './testing/pglite.ts';

const dirs: string[] = [];
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(async () => {
  vi.useRealTimers();
  await db.close();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function boot(services: string) {
  const dir = await mkdtemp(join(tmpdir(), 'dkd-life-'));
  dirs.push(dir);
  const lines: { level: string; msg: string; [k: string]: unknown }[] = [];
  const platform = await createPlatform(
    loadConfig({
      DOCKUDOS_DATABASE_URL: 'postgres://u:pw@db/x',
      DOCKUDOS_PUBLIC_URL: 'https://platform.test',
      DOCKUDOS_SESSION_SECRET: 's'.repeat(40),
      DOCKUDOS_DATA_DIR: dir,
      DOCKUDOS_SERVICES: services,
    }),
    {
      db,
      storage: createMemoryStorage(),
      providers: { github: createMemoryGit('github') },
      log: createLogger({
        level: 'debug',
        write: (l) => lines.push(JSON.parse(l)),
      }),
    },
  );
  return { platform, lines };
}

describe('background timers', () => {
  it('publishes queue depth every 30 s for a web or worker process', async () => {
    const { platform } = await boot('web');
    platform.start();
    expect(platform.metrics.render()).not.toContain('dockudos_jobs{');
    await platform.queue.enqueue('build', { x: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(platform.metrics.render()).toMatch(
      /dockudos_jobs\{status="queued"\} 1/,
    );
    await platform.stop();
  });

  it('ticks the agent every 5 minutes, only in a process with the agent role', async () => {
    const withAgent = await boot('agent');
    const tick = vi
      .spyOn(withAgent.platform.agent, 'tick')
      .mockResolvedValue(0);
    withAgent.platform.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tick).toHaveBeenCalledTimes(3);
    await withAgent.platform.stop();

    const without = await boot('hooks');
    const never = vi.spyOn(without.platform.agent, 'tick').mockResolvedValue(0);
    without.platform.start();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(never).not.toHaveBeenCalled();
    await without.platform.stop();
  });

  it('purges old analytics every 6 hours and logs only when something was removed', async () => {
    const { platform, lines } = await boot('analytics');
    const purge = vi
      .spyOn(platform.analytics, 'purge')
      .mockResolvedValueOnce({ events: 0, conversations: 0 })
      .mockResolvedValueOnce({ events: 4, conversations: 1 });
    platform.start();
    await vi.advanceTimersByTimeAsync(6 * 3600_000);
    expect(lines.some((l) => l.msg === 'analytics purged')).toBe(false);
    await vi.advanceTimersByTimeAsync(6 * 3600_000);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(lines.find((l) => l.msg === 'analytics purged')).toMatchObject({
      events: 4,
      conversations: 1,
    });
    await platform.stop();
  });

  it('logs a failing timer task and keeps the timer running', async () => {
    const { platform, lines } = await boot('agent');
    const tick = vi
      .spyOn(platform.agent, 'tick')
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);
    platform.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(lines.find((l) => l.msg === 'agent tick failed')).toMatchObject({
      level: 'error',
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await platform.stop();
  });

  it('stops every timer on stop(), and says it started', async () => {
    const { platform, lines } = await boot('agent,analytics,web');
    const tick = vi.spyOn(platform.agent, 'tick').mockResolvedValue(0);
    platform.start();
    expect(lines.find((l) => l.msg === 'platform started')).toBeDefined();
    await platform.stop();
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a database it was handed open when it stops', async () => {
    const { platform } = await boot('web');
    await platform.stop();
    await expect(db.query('SELECT 1')).resolves.toBeDefined();
  });
});
