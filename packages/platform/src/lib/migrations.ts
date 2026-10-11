import type { Clock } from './clock.ts';
import { systemClock } from './clock.ts';
import type { Db } from './db.ts';

export interface Migration {
  id: string;
  sql: string;
}

/**
 * Append-only: never edit a migration that has shipped, add a new one. Each runs once, in order, in a
 * transaction, under an advisory lock so several services starting together do not race.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub text NOT NULL UNIQUE,
  email text,
  name text,
  instance_role text NOT NULL DEFAULT 'member' CHECK (instance_role IN ('owner','member')),
  roles text[] NOT NULL DEFAULT '{}',
  groups text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  last_login_at timestamptz
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE memberships (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('github','gitlab')),
  repo text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  docs_dir text NOT NULL DEFAULT '',
  webhook_secret text NOT NULL,
  live_build_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (provider, repo, docs_dir)
);
CREATE TABLE webhook_deliveries (
  provider text NOT NULL,
  delivery_id text NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  event text NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (provider, delivery_id)
);
CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL,
  locked_by text,
  locked_until timestamptz,
  idempotency_key text,
  last_error text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE UNIQUE INDEX jobs_idempotency ON jobs (queue, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_claim ON jobs (queue, run_at) WHERE status IN ('queued','running');
CREATE TABLE builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ref text NOT NULL,
  commit_sha text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  artifact_key text,
  index_key text,
  log text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (site_id, commit_sha, trigger)
);
CREATE INDEX builds_site ON builds (site_id, created_at DESC);
CREATE TABLE edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  branch text NOT NULL,
  base_sha text NOT NULL,
  head_sha text,
  pr_url text,
  mode text NOT NULL CHECK (mode IN ('pr','direct')),
  files jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL
);
CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  size int NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pageview','search','feedback','assistant')),
  day date NOT NULL,
  ts timestamptz NOT NULL,
  path text,
  visitor text,
  traffic text NOT NULL DEFAULT 'human' CHECK (traffic IN ('human','ai','bot')),
  agent text,
  query text,
  results int,
  value text,
  referrer_host text
);
CREATE INDEX analytics_site_day ON analytics_events (site_id, kind, day);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  answered boolean NOT NULL,
  cited_paths text[] NOT NULL DEFAULT '{}',
  ts timestamptz NOT NULL
);
CREATE TABLE site_settings (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  log_conversations boolean NOT NULL DEFAULT false,
  conversation_retention_days int NOT NULL DEFAULT 30,
  event_retention_days int NOT NULL DEFAULT 90,
  code_repos jsonb NOT NULL DEFAULT '[]',
  agent_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  code_repo text,
  base_sha text,
  head_sha text,
  status text NOT NULL CHECK (status IN ('running','opened','flagged','no-changes','failed')),
  branch text,
  pr_url text,
  flagged jsonb NOT NULL DEFAULT '[]',
  error text,
  created_at timestamptz NOT NULL
);
CREATE TABLE automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('outdated-pages','broken-links')),
  interval_hours int NOT NULL DEFAULT 168,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  UNIQUE (site_id, kind)
);
`,
  },
];

const LOCK_KEY = 5_150_001;

/** Apply pending migrations. Returns the ids applied by this call. Safe to run from several processes at once. */
export async function migrate(
  db: Db,
  { clock = systemClock, migrations = MIGRATIONS }: { clock?: Clock; migrations?: Migration[] } = {},
): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL)',
  );
  const applied: string[] = [];
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const done = new Set(
      (await tx.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [m.id, clock()]);
      applied.push(m.id);
    }
  });
  return applied;
}
