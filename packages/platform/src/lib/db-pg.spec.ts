import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from './db.ts';
import { migrate } from './migrations.ts';
import { createQueue } from './queue.ts';

/** The production adapter (`pg` over the Postgres wire protocol) against a real server process, not a mock. */
let lite: PGlite;
let server: PGLiteSocketServer;
let db: Db;
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

beforeAll(async () => {
  lite = await PGlite.create();
  const port = await freePort();
  server = new PGLiteSocketServer({ db: lite, port, host: '127.0.0.1' });
  await server.start();
  db = createPgDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, {
    max: 2,
  });
});
afterAll(async () => {
  await db.close();
  await server.stop();
  await lite.close();
});

describe('createPgDb', () => {
  it('queries with parameters and returns rows and counts', async () => {
    await db.exec('CREATE TABLE t (a int, b text)');
    await db.query('INSERT INTO t VALUES ($1,$2),($3,$4)', [1, 'x', 2, 'y']);
    const r = await db.query<{ a: number; b: string }>(
      'SELECT * FROM t ORDER BY a',
    );
    expect(r.rows).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
    expect(r.rowCount).toBe(2);
    expect(
      (await db.query('UPDATE t SET b = $1 WHERE a = 1', ['z'])).rowCount,
    ).toBe(1);
  });

  it('commits a transaction on return and rolls back on throw', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query('INSERT INTO t VALUES (3, $1)', ['gone']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.query('SELECT 1 FROM t WHERE a = 3')).rowCount).toBe(0);
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO t VALUES (4, $1)', ['kept']);
    });
    expect((await db.query('SELECT 1 FROM t WHERE a = 4')).rowCount).toBe(1);
  });

  it('runs the real migrations and the job queue (SKIP LOCKED) through the production adapter', async () => {
    expect(await migrate(db)).toContain('0001_init');
    const q = createQueue({ db });
    const id = await q.enqueue(
      'pg',
      { hello: 'world' },
      { idempotencyKey: 'k' },
    );
    expect(await q.enqueue('pg', {}, { idempotencyKey: 'k' })).toBe(id);
    const job = await q.claim(['pg'], 'w');
    expect(job).toMatchObject({ id, payload: { hello: 'world' }, attempts: 1 });
    await q.complete(id);
    expect((await q.stats())['done']).toBe(1);
  });
});
