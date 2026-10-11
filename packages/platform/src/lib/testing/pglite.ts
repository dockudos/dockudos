import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from '../db.ts';
import { migrate } from '../migrations.ts';

/** A real Postgres (WASM, in-process) for tests: same SQL, same constraints, no server to start. */
export async function createTestDb(): Promise<Db> {
  const lite = new PGlite();
  await lite.waitReady;
  const wrap = (q: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await q.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.rows.length || (r.affectedRows ?? 0) };
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  const db: Db = {
    ...wrap(lite),
    transaction: (fn) => lite.transaction((tx) => fn(wrap(tx))),
    close: () => lite.close(),
  };
  await migrate(db);
  return db;
}
