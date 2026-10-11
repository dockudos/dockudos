import { afterAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from './migrations.ts';
import { createTestDb } from './testing/pglite.ts';

describe('migrations', () => {
  const dbs: { close(): Promise<void> }[] = [];
  afterAll(() => Promise.all(dbs.map((d) => d.close())));

  it('applies every migration once and is idempotent', async () => {
    const db = await createTestDb();
    dbs.push(db);
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM schema_migrations',
    );
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('rolls a failing migration back entirely', async () => {
    const db = await createTestDb();
    dbs.push(db);
    await expect(
      migrate(db, {
        migrations: [
          {
            id: '9999_bad',
            sql: 'CREATE TABLE ok_t (a int); SELECT nope FROM nothing;',
          },
        ],
      }),
    ).rejects.toThrow();
    const t = await db.query("SELECT to_regclass('ok_t') AS t");
    expect((t.rows[0] as { t: unknown }).t).toBeNull();
  });

  it('transaction rolls back on throw and commits on return', async () => {
    const db = await createTestDb();
    dbs.push(db);
    await db.exec('CREATE TABLE t (a int)');
    await expect(
      db.transaction(async (tx) => {
        await tx.query('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await db.transaction((tx) => tx.query('INSERT INTO t VALUES (2)'));
    expect((await db.query('SELECT a FROM t')).rows).toEqual([{ a: 2 }]);
  });
});
