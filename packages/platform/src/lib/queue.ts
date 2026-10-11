import { randomUUID } from 'node:crypto';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { type Logger, silentLogger } from './logger.ts';
import type { MetricsRegistry } from './metrics.ts';

export interface Job<P = Record<string, unknown>> {
  id: number;
  queue: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueOptions {
  /** A second enqueue with the same key (on the same queue) is a no-op and returns the first job's id. */
  idempotencyKey?: string;
  maxAttempts?: number;
  /** Do not run before this time. */
  runAt?: Date;
}

/** Throw this from a handler when retrying cannot help (bad input, repository gone): the job goes straight to `dead`. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

interface JobRow {
  id: string | number;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface QueueOptions {
  db: Db;
  clock?: Clock;
}

/** Retry delay: 5 s, 10 s, 20 s ... capped at 10 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempt - 1), 600_000);
}

/**
 * A job queue on Postgres. `FOR UPDATE SKIP LOCKED` lets many workers claim without blocking each other; a job
 * whose worker died is picked up again when its lease expires. Delivery is at least once, so handlers must be
 * idempotent: use `idempotencyKey` to stop duplicates being queued, and write handlers that can run twice.
 */
export function createQueue({ db, clock = systemClock }: QueueOptions) {
  const toJob = (r: JobRow): Job => ({
    id: Number(r.id),
    queue: r.queue,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  });
  return {
    async enqueue(
      queue: string,
      payload: Record<string, unknown>,
      { idempotencyKey, maxAttempts = 5, runAt }: EnqueueOptions = {},
    ): Promise<number> {
      const now = clock();
      const { rows } = await db.query<{ id: string | number }>(
        `INSERT INTO jobs (queue, payload, max_attempts, run_at, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (queue, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [queue, JSON.stringify(payload), maxAttempts, runAt ?? now, idempotencyKey ?? null, now],
      );
      if (rows[0]) return Number(rows[0].id);
      const existing = await db.query<{ id: string | number }>(
        'SELECT id FROM jobs WHERE queue = $1 AND idempotency_key = $2',
        [queue, idempotencyKey],
      );
      return Number(existing.rows[0]!.id);
    },

    /** Claim the next runnable job on any of `queues`, leasing it for `leaseMs`. */
    async claim(queues: string[], worker: string, leaseMs = 300_000): Promise<Job | undefined> {
      const now = clock();
      await db.query(
        `UPDATE jobs SET status = 'dead', finished_at = $1, last_error = COALESCE(last_error, 'lease expired after the last attempt')
         WHERE status = 'running' AND locked_until < $1 AND attempts >= max_attempts`,
        [now],
      );
      const { rows } = await db.query<JobRow>(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = $3, locked_until = $4
         WHERE id = (
           SELECT id FROM jobs
           WHERE queue = ANY($1::text[])
             AND ((status = 'queued' AND run_at <= $2) OR (status = 'running' AND locked_until < $2))
           ORDER BY run_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
         RETURNING id, queue, payload, attempts, max_attempts`,
        [queues, now, worker, new Date(now.getTime() + leaseMs)],
      );
      return rows[0] ? toJob(rows[0]) : undefined;
    },

    async complete(id: number): Promise<void> {
      await db.query(
        `UPDATE jobs SET status = 'done', finished_at = $2, locked_by = NULL, locked_until = NULL WHERE id = $1`,
        [id, clock()],
      );
    },

    /** Record a failure: retry with backoff, or give up (`dead`) when attempts are used up or `retry` is false. */
    async fail(job: Job, error: unknown, retry = true): Promise<'retry' | 'dead'> {
      const now = clock();
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      if (!retry || job.attempts >= job.maxAttempts) {
        await db.query(
          `UPDATE jobs SET status = 'dead', last_error = $2, finished_at = $3, locked_by = NULL, locked_until = NULL WHERE id = $1`,
          [job.id, message, now],
        );
        return 'dead';
      }
      await db.query(
        `UPDATE jobs SET status = 'queued', last_error = $2, run_at = $3, locked_by = NULL, locked_until = NULL WHERE id = $1`,
        [job.id, message, new Date(now.getTime() + backoffMs(job.attempts))],
      );
      return 'retry';
    },

    async stats(): Promise<Record<string, number>> {
      const { rows } = await db.query<{ status: string; n: string | number }>(
        'SELECT status, count(*) AS n FROM jobs GROUP BY status',
      );
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },
  };
}

export type Queue = ReturnType<typeof createQueue>;
export type JobHandler = (job: Job, ctx: { log: Logger; signal: AbortSignal }) => Promise<void>;

export interface WorkerOptions {
  queue: Queue;
  handlers: Record<string, JobHandler>;
  concurrency?: number;
  pollMs?: number;
  leaseMs?: number;
  log?: Logger;
  metrics?: MetricsRegistry;
  id?: string;
}

/** Runs handlers for the queues it has handlers for. `runOnce` is one claim-and-run, for tests and cron-style use. */
export function createWorker({
  queue,
  handlers,
  concurrency = 2,
  pollMs = 1000,
  leaseMs = 300_000,
  log = silentLogger,
  metrics,
  id = `worker-${randomUUID().slice(0, 8)}`,
}: WorkerOptions) {
  const names = Object.keys(handlers);
  const done = metrics?.counter('dockudos_jobs_total', 'Jobs finished, by queue and outcome');
  const took = metrics?.histogram('dockudos_job_seconds', 'Job run time in seconds');
  let stopping = false;
  const abort = new AbortController();

  async function runOnce(): Promise<boolean> {
    const job = await queue.claim(names, id, leaseMs);
    if (!job) return false;
    const jlog = log.child({ job: job.id, queue: job.queue, attempt: job.attempts });
    const start = Date.now();
    try {
      await handlers[job.queue]!(job, { log: jlog, signal: abort.signal });
      await queue.complete(job.id);
      done?.inc({ queue: job.queue, outcome: 'done' });
      jlog.info('job done');
    } catch (error) {
      const retry = !(error instanceof NonRetryableError);
      const outcome = await queue.fail(job, error, retry);
      done?.inc({ queue: job.queue, outcome });
      jlog[outcome === 'dead' ? 'error' : 'warn']('job failed', { error, outcome });
    } finally {
      took?.observe((Date.now() - start) / 1000, { queue: job.queue });
    }
    return true;
  }

  let loops: Promise<void>[] = [];
  return {
    id,
    runOnce,
    start() {
      stopping = false;
      loops = Array.from({ length: concurrency }, async () => {
        while (!stopping) {
          let ran = false;
          try {
            ran = await runOnce();
          } catch (error) {
            log.error('worker loop error', { error });
          }
          if (!ran && !stopping) await new Promise((r) => setTimeout(r, pollMs));
        }
      });
    },
    /** Stop claiming, tell running handlers to wrap up, and wait for them. */
    async stop() {
      stopping = true;
      abort.abort();
      await Promise.all(loops);
    },
  };
}
