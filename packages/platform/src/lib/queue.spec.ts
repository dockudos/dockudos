import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { backoffMs, createQueue, createWorker, NonRetryableError } from './queue.ts';
import { MetricsRegistry } from './metrics.ts';
import { createTestDb } from './testing/pglite.ts';

let db: Db;
let t = new Date('2026-01-01T00:00:00Z');
const clock = () => t;
const advance = (ms: number) => (t = new Date(t.getTime() + ms));
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

describe('queue', () => {
  it('claims in order and completes', async () => {
    const q = createQueue({ db, clock });
    const a = await q.enqueue('q1', { n: 1 });
    const b = await q.enqueue('q1', { n: 2 });
    const first = await q.claim(['q1'], 'w');
    expect(first).toMatchObject({ id: a, payload: { n: 1 }, attempts: 1 });
    await q.complete(a);
    expect((await q.claim(['q1'], 'w'))?.id).toBe(b);
    expect(await q.claim(['q1'], 'w')).toBeUndefined();
    expect(await q.claim(['other'], 'w')).toBeUndefined();
  });

  it('does not queue a duplicate for the same idempotency key', async () => {
    const q = createQueue({ db, clock });
    const a = await q.enqueue('idem', {}, { idempotencyKey: 'k' });
    const b = await q.enqueue('idem', {}, { idempotencyKey: 'k' });
    expect(b).toBe(a);
    expect((await db.query("SELECT 1 FROM jobs WHERE queue = 'idem'")).rowCount).toBe(1);
  });

  it('hands one job to only one of two concurrent claimers', async () => {
    const q = createQueue({ db, clock });
    await q.enqueue('race', {});
    const got = await Promise.all([q.claim(['race'], 'a'), q.claim(['race'], 'b')]);
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it('retries with backoff, then marks dead after max attempts', async () => {
    const q = createQueue({ db, clock });
    const id = await q.enqueue('retry', {}, { maxAttempts: 2 });
    let job = (await q.claim(['retry'], 'w'))!;
    expect(await q.fail(job, new Error('first'))).toBe('retry');
    expect(await q.claim(['retry'], 'w')).toBeUndefined();
    advance(backoffMs(1));
    job = (await q.claim(['retry'], 'w'))!;
    expect(job.attempts).toBe(2);
    expect(await q.fail(job, new Error('second'))).toBe('dead');
    advance(10 * 60_000);
    expect(await q.claim(['retry'], 'w')).toBeUndefined();
    const row = (await db.query<{ status: string; last_error: string }>('SELECT status, last_error FROM jobs WHERE id = $1', [id])).rows[0]!;
    expect(row).toEqual({ status: 'dead', last_error: 'second' });
  });

  it('reclaims a job whose worker died, and gives up on one that always dies', async () => {
    const q = createQueue({ db, clock });
    await q.enqueue('lease', {}, { maxAttempts: 2 });
    expect((await q.claim(['lease'], 'dead-worker', 1000))?.attempts).toBe(1);
    expect(await q.claim(['lease'], 'w2', 1000)).toBeUndefined();
    advance(2000);
    expect((await q.claim(['lease'], 'w2', 1000))?.attempts).toBe(2);
    advance(2000);
    expect(await q.claim(['lease'], 'w3', 1000)).toBeUndefined();
    expect((await q.stats())['dead']).toBeGreaterThanOrEqual(1);
  });

  it('caps the backoff', () => {
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(30)).toBe(600_000);
  });
});

describe('worker', () => {
  it('runs handlers, retries failures, and kills non-retryable ones', async () => {
    const q = createQueue({ db, clock });
    const metrics = new MetricsRegistry();
    let calls = 0;
    const worker = createWorker({
      queue: q,
      metrics,
      handlers: {
        'w-ok': async () => {
          calls += 1;
        },
        'w-flaky': async (job) => {
          if (job.attempts < 2) throw new Error('flaky');
        },
        'w-fatal': async () => {
          throw new NonRetryableError('bad input');
        },
      },
    });
    await q.enqueue('w-ok', {});
    await q.enqueue('w-flaky', {});
    await q.enqueue('w-fatal', {});
    while (await worker.runOnce());
    expect(calls).toBe(1);
    advance(10_000);
    while (await worker.runOnce());
    const status = Object.fromEntries(
      (await db.query<{ queue: string; status: string }>("SELECT queue, status FROM jobs WHERE queue LIKE 'w-%'")).rows.map((r) => [r.queue, r.status]),
    );
    expect(status).toEqual({ 'w-ok': 'done', 'w-flaky': 'done', 'w-fatal': 'dead' });
    expect(metrics.render()).toContain('dockudos_jobs_total{outcome="dead",queue="w-fatal"} 1');
  });

  it('start and stop drain the loop', async () => {
    const q = createQueue({ db });
    let ran = false;
    const worker = createWorker({ queue: q, pollMs: 5, concurrency: 1, handlers: { 'w-loop': async () => void (ran = true) } });
    await q.enqueue('w-loop', {});
    worker.start();
    for (let i = 0; i < 100 && !ran; i++) await new Promise((r) => setTimeout(r, 20));
    await worker.stop();
    expect(ran).toBe(true);
  });
});
