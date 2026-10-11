import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BACKUP_TABLES, backup, type BackupSink, createFsSink, describeDir, restore, RestoreError } from './backup.ts';
import { createAnalytics } from './analytics.ts';
import type { Db } from './db.ts';
import { createMemoryStorage } from './storage.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

const dbs: Db[] = [];
const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'dkd-bak-')); dirs.push(d); return d; };
afterAll(async () => { await Promise.all(dbs.map((d) => d.close())); await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const memorySink = (): BackupSink & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>();
  return { files, write: async (p, b) => void files.set(p, b), read: async (p) => files.get(p) };
};
const dump = async (db: Db) => Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, (await db.query<{ j: unknown }>(`SELECT row_to_json(x) AS j FROM ${t} x`)).rows.map((r) => JSON.stringify(r.j)).sort()])));

async function seeded() {
  const db = await createTestDb();
  dbs.push(db);
  const f = await createFixture(db, { index: { version: 1, builtAt: 'x', pages: [], chunks: [] } });
  await f.builds.rebuild(f.actor, f.site.id);
  await f.drain();
  await f.auth.createApiKey(f.actor, f.team.id, 'ci', 'editor');
  const an = createAnalytics({ db, sites: f.sites, auth: f.auth, secret: 'k', clock: f.clock });
  await an.updateSettings(f.actor, f.site.id, { logConversations: true });
  for (let i = 0; i < 5; i++) await an.ingest(f.site.id, { kind: 'pageview', path: `/p${i}` }, { ip: `1.1.1.${i}`, userAgent: 'Firefox' });
  await an.ingest(f.site.id, { kind: 'assistant', query: 'how do I?', value: 'unanswered' }, { ip: '1.1.1.1', userAgent: 'Firefox' });
  return { db, f };
}

describe('backup and restore (P5 acceptance: exercised once)', () => {
  it('round-trips every table and every object into a fresh instance, which then keeps working', async () => {
    const { db, f } = await seeded();
    const sink = memorySink();
    const manifest = await backup(db, f.storage, sink, { clock: f.clock });
    expect(manifest.tables['analytics_events']!.rows).toBe(5 + 1);
    expect(manifest.objects.count).toBeGreaterThan(0);

    const fresh = await createTestDb();
    dbs.push(fresh);
    const storage = createMemoryStorage();
    await restore(fresh, storage, sink);
    expect(await dump(fresh)).toEqual(await dump(db));
    expect(await storage.list('')).toEqual(await f.storage.list(''));
    for (const key of await f.storage.list('')) expect(await storage.get(key)).toEqual(await f.storage.get(key));

    // The restored instance is alive: ids continue past the old ones, and the live site is served from restored objects.
    const before = Number(((await fresh.query<{ m: string }>('SELECT max(id) AS m FROM analytics_events')).rows[0]!).m);
    const an = createAnalytics({ db: fresh, sites: f.sites, auth: f.auth, secret: 'k', clock: f.clock });
    void an;
    await fresh.query(`INSERT INTO analytics_events (site_id, kind, day, ts, path, traffic) VALUES ($1,'pageview','2026-03-02',now(),'/after','human')`, [f.site.id]);
    expect(Number(((await fresh.query<{ m: string }>('SELECT max(id) AS m FROM analytics_events')).rows[0]!).m)).toBe(before + 1);
    const live = (await fresh.query<{ live_build_id: string }>('SELECT live_build_id FROM sites')).rows[0]!.live_build_id;
    expect(await storage.get(`builds/${live}/site/index.html`)).toBeDefined();
  });

  it('writes to disk readable by the owner only, and reads it back', async () => {
    const { db, f } = await seeded();
    const dir = await tmp();
    await backup(db, f.storage, createFsSink(dir), { clock: f.clock });
    expect((await stat(join(dir, 'manifest.json'))).mode & 0o077).toBe(0);
    expect((await stat(join(dir, 'db', 'users.ndjson'))).mode & 0o077).toBe(0);
    expect(await describeDir(dir)).toMatch(/\d+ files/);
    const fresh = await createTestDb();
    dbs.push(fresh);
    await restore(fresh, createMemoryStorage(), createFsSink(dir));
    expect(await dump(fresh)).toEqual(await dump(db));
    expect(await createFsSink(dir).read('nope.json')).toBeUndefined();
    await expect(createFsSink(dir).write('../escape', new Uint8Array())).rejects.toThrow('Unsafe');
  });

  it('refuses a corrupted or edited backup before writing anything', async () => {
    const { db, f } = await seeded();
    const sink = memorySink();
    await backup(db, f.storage, sink);
    const fresh = await createTestDb();
    dbs.push(fresh);
    sink.files.set('db/users.ndjson', new TextEncoder().encode('{"id":"x"}\n'));
    await expect(restore(fresh, createMemoryStorage(), sink)).rejects.toThrow('does not match the manifest');
    expect((await fresh.query('SELECT 1 FROM users')).rowCount).toBe(0);
    const good = memorySink();
    await backup(db, f.storage, good);
    const key = [...good.files.keys()].find((k) => k.startsWith('objects/') && k !== 'objects.json')!;
    good.files.set(key, new Uint8Array([1, 2, 3]));
    await expect(restore(fresh, createMemoryStorage(), good)).rejects.toThrow('does not match the manifest');
    good.files.delete(key);
    await expect(restore(fresh, createMemoryStorage(), good)).rejects.toThrow('missing');
  });

  it('refuses things that are not backups, other versions, and instances that already have data', async () => {
    const { db, f } = await seeded();
    const sink = memorySink();
    await backup(db, f.storage, sink);
    const fresh = await createTestDb();
    dbs.push(fresh);
    await expect(restore(fresh, createMemoryStorage(), memorySink())).rejects.toThrow('manifest.json is missing');
    const manifest = JSON.parse(new TextDecoder().decode(sink.files.get('manifest.json')));
    sink.files.set('manifest.json', new TextEncoder().encode(JSON.stringify({ ...manifest, schema: '0000_old' })));
    await expect(restore(fresh, createMemoryStorage(), sink)).rejects.toThrow('schema 0000_old');
    sink.files.set('manifest.json', new TextEncoder().encode(JSON.stringify({ ...manifest, format: 9 })));
    await expect(restore(fresh, createMemoryStorage(), sink)).rejects.toThrow('Unsupported backup format');
    sink.files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(restore(db, createMemoryStorage(), sink)).rejects.toBeInstanceOf(RestoreError);
    sink.files.set('objects.json', new TextEncoder().encode('[]'));
    await expect(restore(fresh, createMemoryStorage(), sink)).rejects.toThrow('objects.json');
  });

  it('pages through large tables', async () => {
    const db = await createTestDb();
    dbs.push(db);
    const f = await createFixture(db);
    await db.query(`INSERT INTO analytics_events (site_id, kind, day, ts, path, traffic) SELECT $1, 'pageview', '2026-03-01', now(), '/p' || g, 'human' FROM generate_series(1, 4500) g`, [f.site.id]);
    const sink = memorySink();
    const m = await backup(db, f.storage, sink);
    expect(m.tables['analytics_events']!.rows).toBe(4500);
    const fresh = await createTestDb();
    dbs.push(fresh);
    await restore(fresh, createMemoryStorage(), sink);
    expect(Number((await fresh.query<{ n: string }>("SELECT count(*) AS n FROM analytics_events")).rows[0]!.n)).toBe(4500);
  });
});

