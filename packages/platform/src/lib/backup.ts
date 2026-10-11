import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { MIGRATIONS } from './migrations.ts';
import type { ObjectStorage } from './storage.ts';

/** Where a backup is written and read. A directory on disk in production, a map in tests. */
export interface BackupSink {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array | undefined>;
}

/** A backup directory. Files are readable by their owner only: a backup holds webhook secrets and people's emails. */
export function createFsSink(root: string): BackupSink {
  const base = resolve(root);
  const full = (p: string) => {
    const f = resolve(base, p);
    if (!f.startsWith(base + sep)) throw new Error(`Unsafe backup path: ${p}`);
    return f;
  };
  return {
    async write(p, bytes) {
      const f = full(p);
      await mkdir(dirname(f), { recursive: true, mode: 0o700 });
      await writeFile(f, bytes, { mode: 0o600 });
    },
    async read(p) {
      try {
        return new Uint8Array(await readFile(full(p)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw e;
      }
    },
  };
}

/** Tables in dependency order. Jobs are transient and sessions are stateless, so neither is saved. */
export const BACKUP_TABLES = [
  'users',
  'teams',
  'memberships',
  'api_keys',
  'sites',
  'webhook_deliveries',
  'builds',
  'edits',
  'uploads',
  'analytics_events',
  'conversations',
  'site_settings',
  'agent_runs',
  'automations',
] as const;
/** Tables with a serial column to move forward after rows are inserted with their old ids. */
const SERIALS: Record<string, string> = {
  analytics_events: 'id',
  agent_runs: 'seq',
};
const BATCH = 2000;
const sha = (b: Uint8Array | string) =>
  createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface Manifest {
  format: 1;
  createdAt: string;
  schema: string;
  tables: Record<string, { rows: number; sha256: string }>;
  objects: { count: number; bytes: number; sha256: string };
}

/**
 * Save everything that is not rebuildable: every table (as one JSON object per line) and every stored object. Builds'
 * output is included, so a restored instance serves its sites immediately. The result is portable between Postgres
 * versions and hosts. For a physical copy of a large database, `pg_dump` is still the faster tool; this is the one that
 * also carries the objects and can be checked and restored by the platform itself.
 */
export async function backup(
  db: Db,
  storage: ObjectStorage,
  sink: BackupSink,
  { clock = systemClock }: { clock?: Clock } = {},
): Promise<Manifest> {
  const tables: Manifest['tables'] = {};
  // One transaction, so the tables are a consistent snapshot of each other.
  await db.transaction(async (tx) => {
    await tx
      .exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      .catch(() => undefined);
    for (const t of BACKUP_TABLES) {
      const lines: string[] = [];
      const serial = SERIALS[t];
      if (serial) {
        for (let last = 0; ; ) {
          const { rows } = await tx.query<{ j: Record<string, unknown> }>(
            `SELECT row_to_json(x) AS j FROM ${t} x WHERE ${serial} > $1 ORDER BY ${serial} LIMIT ${BATCH}`,
            [last],
          );
          for (const r of rows) lines.push(JSON.stringify(r.j));
          if (rows.length < BATCH) break;
          last = Number(rows.at(-1)!.j[serial]);
        }
      } else {
        const { rows } = await tx.query<{ j: unknown }>(
          `SELECT row_to_json(x) AS j FROM ${t} x`,
        );
        for (const r of rows) lines.push(JSON.stringify(r.j));
      }
      const body = enc.encode(lines.length ? `${lines.join('\n')}\n` : '');
      await sink.write(`db/${t}.ndjson`, body);
      tables[t] = { rows: lines.length, sha256: sha(body) };
    }
  });
  const keys = await storage.list('');
  const index: { key: string; size: number; sha256: string }[] = [];
  let bytes = 0;
  for (const key of keys) {
    const data = await storage.get(key);
    if (!data) continue;
    await sink.write(`objects/${key}`, data);
    index.push({ key, size: data.length, sha256: sha(data) });
    bytes += data.length;
  }
  const indexBody = enc.encode(JSON.stringify(index));
  await sink.write('objects.json', indexBody);
  const manifest: Manifest = {
    format: 1,
    createdAt: clock().toISOString(),
    schema: MIGRATIONS.at(-1)!.id,
    tables,
    objects: { count: index.length, bytes, sha256: sha(indexBody) },
  };
  await sink.write(
    'manifest.json',
    enc.encode(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  return manifest;
}

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

/**
 * Load a backup into an instance that has been migrated but has no data. Every file is checked against the manifest
 * before anything is written, the database is restored in one transaction (all or nothing), and an instance that already
 * has data is refused: restoring is for a new or emptied one.
 */
export async function restore(
  db: Db,
  storage: ObjectStorage,
  sink: BackupSink,
): Promise<Manifest> {
  const raw = await sink.read('manifest.json');
  if (!raw)
    throw new RestoreError(
      'This is not a dockudos backup: manifest.json is missing.',
    );
  const manifest = JSON.parse(dec.decode(raw)) as Manifest;
  if (manifest.format !== 1)
    throw new RestoreError(
      `Unsupported backup format ${String(manifest.format)}.`,
    );
  if (manifest.schema !== MIGRATIONS.at(-1)!.id)
    throw new RestoreError(
      `The backup is from schema ${manifest.schema} but this version is ${MIGRATIONS.at(-1)!.id}. Restore with the version that made it, then upgrade.`,
    );

  const data: Record<string, string> = {};
  for (const t of BACKUP_TABLES) {
    const body = await sink.read(`db/${t}.ndjson`);
    const want = manifest.tables[t];
    if (!want) throw new RestoreError(`The manifest has no entry for ${t}.`);
    const text = body ? dec.decode(body) : '';
    if (sha(body ?? new Uint8Array()) !== want.sha256)
      throw new RestoreError(
        `db/${t}.ndjson does not match the manifest (corrupt or edited).`,
      );
    data[t] = text;
  }
  const indexBody = await sink.read('objects.json');
  if (!indexBody || sha(indexBody) !== manifest.objects.sha256)
    throw new RestoreError('objects.json does not match the manifest.');
  const index = JSON.parse(dec.decode(indexBody)) as {
    key: string;
    size: number;
    sha256: string;
  }[];
  const objects: { key: string; bytes: Uint8Array }[] = [];
  for (const o of index) {
    const bytes = await sink.read(`objects/${o.key}`);
    if (!bytes || sha(bytes) !== o.sha256)
      throw new RestoreError(
        `Object ${o.key} is missing or does not match the manifest.`,
      );
    objects.push({ key: o.key, bytes });
  }

  await db.transaction(async (tx) => {
    for (const t of ['users', 'teams', 'sites'])
      if ((await tx.query(`SELECT 1 FROM ${t} LIMIT 1`)).rowCount > 0)
        throw new RestoreError(
          'This instance already has data. Restore into a new, migrated, empty database.',
        );
    for (const t of BACKUP_TABLES) {
      const rows = data[t]!.split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as unknown);
      for (let i = 0; i < rows.length; i += 1000)
        await tx.query(
          `INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + 1000))],
        );
      const serial = SERIALS[t];
      if (serial && rows.length)
        await tx.query(
          `SELECT setval(pg_get_serial_sequence('${t}', '${serial}'), (SELECT max(${serial}) FROM ${t}))`,
        );
    }
  });
  for (const o of objects) await storage.put(o.key, o.bytes);
  return manifest;
}

/** For the command line: how big is what is being backed up. */
export async function describeDir(dir: string): Promise<string> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        files++;
        bytes += (await stat(p)).size;
      }
    }
  };
  await walk(dir);
  return `${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
