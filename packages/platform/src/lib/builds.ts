import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, posix, resolve, sep } from 'node:path';
import type { Actor, Auth } from './auth.ts';
import { type Clock, systemClock } from './clock.ts';
import type { Db, Queryable } from './db.ts';
import { notFound } from './errors.ts';
import { type CommandRunner, spawnRunner } from './exec.ts';
import type { GitProvider, ProviderId } from './git/types.ts';
import { createScrubber, type Logger, silentLogger } from './logger.ts';
import type { MetricsRegistry } from './metrics.ts';
import { type Job, NonRetryableError, type Queue } from './queue.ts';
import type { Site, Sites } from './sites.ts';
import { apiSource, gitSource, type SourceFetcher } from './sources.ts';
import type { ObjectStorage } from './storage.ts';

export const BUILD_QUEUE = 'build';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
export const contentType = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

export interface Build {
  id: string;
  siteId: string;
  ref: string;
  commitSha: string;
  trigger: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
}
interface BuildRow {
  id: string; site_id: string; ref: string; commit_sha: string; trigger: string; status: Build['status'];
  error: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null; log?: string;
}
const toBuild = (r: BuildRow): Build => ({
  id: r.id, siteId: r.site_id, ref: r.ref, commitSha: r.commit_sha, trigger: r.trigger, status: r.status, createdAt: r.created_at,
  ...(r.error && { error: r.error }), ...(r.started_at && { startedAt: r.started_at }), ...(r.finished_at && { finishedAt: r.finished_at }),
});

const MAX_FILES = 20_000;
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_LOG = 256 * 1024;

export interface BuildsOptions {
  db: Db;
  queue: Queue;
  storage: ObjectStorage;
  sites: Sites;
  auth: Auth;
  providers: Partial<Record<ProviderId, GitProvider>>;
  run?: CommandRunner;
  /** Default: `git fetch --depth 1`. */
  source?: SourceFetcher;
  clock?: Clock;
  log?: Logger;
  metrics?: MetricsRegistry;
  secrets?: readonly string[];
  /** Where a finished build is served, for the link on the commit status. */
  siteUrl?: (site: Site) => string;
  workRoot?: string;
  buildTimeoutMs?: number;
  keepBuilds?: number;
}

/** Build history, the runner behind the `build` queue, and serving of the live build. */
export function createBuilds({
  db, queue, storage, sites, auth, providers, run = spawnRunner, source, clock = systemClock, log = silentLogger, metrics,
  secrets = [], siteUrl, workRoot = tmpdir(), buildTimeoutMs = 900_000, keepBuilds = 10,
}: BuildsOptions) {
  const scrub = createScrubber(secrets);
  const fetchSource = source ?? gitSource(run);
  const finished = metrics?.counter('dockudos_builds_total', 'Builds finished, by outcome');
  const duration = metrics?.histogram('dockudos_build_seconds', 'Build time in seconds', [5, 15, 30, 60, 120, 300, 900]);

  /** Queue a build of `sha`. Calling it again for the same commit and trigger returns the build that already exists. */
  async function request(site: Pick<Site, 'id'>, sha: string, ref: string, trigger: string, via: Queryable = db): Promise<{ buildId: string; created: boolean }> {
    const ins = await via.query<{ id: string }>(
      `INSERT INTO builds (site_id, ref, commit_sha, trigger, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (site_id, commit_sha, trigger) DO NOTHING RETURNING id`,
      [site.id, ref, sha, trigger, clock()]);
    if (ins.rows[0]) {
      await queue.enqueue(BUILD_QUEUE, { buildId: ins.rows[0].id }, { idempotencyKey: ins.rows[0].id, via, maxAttempts: 3 });
      return { buildId: ins.rows[0].id, created: true };
    }
    const existing = await via.query<{ id: string; status: string }>('SELECT id, status FROM builds WHERE site_id = $1 AND commit_sha = $2 AND trigger = $3', [site.id, sha, trigger]);
    return { buildId: existing.rows[0]!.id, created: false };
  }

  async function appendLog(buildId: string, text: string) {
    await db.query(`UPDATE builds SET log = right(log || $2, ${MAX_LOG}) WHERE id = $1`, [buildId, text]);
  }

  async function uploadDir(dir: string, prefix: string): Promise<number> {
    const root = resolve(dir);
    let files = 0;
    let bytes = 0;
    async function walk(current: string): Promise<void> {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        const info = await lstat(full);
        if (info.isSymbolicLink()) continue; // never follow a link out of the build folder
        if (info.isDirectory()) await walk(full);
        else if (info.isFile()) {
          if (++files > MAX_FILES) throw new NonRetryableError(`The site has more than ${MAX_FILES} files.`);
          bytes += info.size;
          if (bytes > MAX_BYTES) throw new NonRetryableError('The site is larger than 500 MB.');
          const rel = full.slice(root.length + 1).split(sep).join('/');
          await storage.put(`${prefix}${rel}`, new Uint8Array(await readFile(full)), contentType(rel));
        }
      }
    }
    await walk(root);
    return files;
  }

  /** The `build` job handler. Idempotent: running it again for the same build redoes the work and ends in the same state. */
  async function handle(job: Job, ctx: { log: Logger; signal: AbortSignal }): Promise<void> {
    const buildId = String(job.payload['buildId']);
    const row = (await db.query<BuildRow>('SELECT * FROM builds WHERE id = $1', [buildId])).rows[0];
    if (!row) throw new NonRetryableError('The build no longer exists.');
    if (row.status === 'succeeded') return;
    const site = await sites.internal(row.site_id).catch(() => undefined);
    if (!site) throw new NonRetryableError('The site no longer exists.');
    const provider = providers[site.provider];
    if (!provider) throw new NonRetryableError(`${site.provider} is not configured.`);
    const started = Date.now();
    const blog = ctx.log.child({ build: buildId, site: site.id });
    await db.query(`UPDATE builds SET status = 'running', started_at = $2, log = '', error = NULL WHERE id = $1`, [buildId, clock()]);
    await provider.reportStatus?.({ repo: site.repo, sha: row.commit_sha, state: 'pending', description: 'Building docs' }).catch(() => undefined);

    let pending = '';
    let flush = Promise.resolve();
    const onOutput = (chunk: string) => {
      pending += scrub(chunk);
      if (pending.length > 2000) {
        const text = pending;
        pending = '';
        flush = flush.then(() => appendLog(buildId, text)).catch(() => undefined);
      }
    };
    const work = await mkdtemp(join(workRoot, 'dockudos-build-'));
    try {
      const checkout = join(work, 'src');
      await mkdir(checkout, { recursive: true });
      onOutput(`Fetching ${site.repo}@${row.commit_sha.slice(0, 12)}\n`);
      await fetchSource({ provider, repo: site.repo, sha: row.commit_sha, dest: checkout, onOutput, signal: ctx.signal });
      const cwd = join(checkout, site.docsDir);
      if (!resolve(cwd).startsWith(resolve(checkout))) throw new NonRetryableError('docsDir is outside the repository.');
      if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) throw new NonRetryableError(`The docs folder "${site.docsDir}" does not exist at this commit.`);

      const step = async (cmd: string, args: string[], fatal = true) => {
        onOutput(`$ ${cmd} ${args.join(' ')}\n`);
        const { code } = await run({ cmd, args, cwd, onOutput, timeoutMs: buildTimeoutMs, signal: ctx.signal });
        if (code !== 0 && fatal) throw new NonRetryableError(`\`${cmd} ${args.join(' ')}\` failed (exit ${code}).`);
        return code;
      };
      // Lifecycle scripts of dependencies do not run: a build of someone's repository must not be handed free code execution.
      const pm = await detectPackageManager(cwd);
      await step(pm.cmd, pm.install);
      await step('npx', ['--no-install', 'dockudos', 'build', '--static', '--no-sync']);
      const out = join(cwd, 'out');
      if (!(await stat(join(out, 'index.html')).catch(() => undefined))) throw new NonRetryableError('The build produced no out/index.html.');
      await step('npx', ['--no-install', 'dockudos', 'index'], false);

      const prefix = `builds/${buildId}/`;
      const files = await uploadDir(out, `${prefix}site/`);
      const indexFile = await readFile(join(cwd, '.dockudos', 'index.json')).catch(() => undefined);
      if (indexFile) await storage.put(`${prefix}index.json`, new Uint8Array(indexFile), 'application/json');
      onOutput(`Published ${files} files\n`);

      await flush;
      await appendLog(buildId, pending);
      pending = '';
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE builds SET status = 'succeeded', artifact_key = $2, index_key = $3, finished_at = $4 WHERE id = $1`,
          [buildId, `${prefix}site/`, indexFile ? `${prefix}index.json` : null, clock()]);
        // Go live only if nothing newer already is: an old build that finishes late must not roll the site back.
        await tx.query(
          `UPDATE sites SET live_build_id = $2 WHERE id = $1 AND (live_build_id IS NULL OR
             (SELECT created_at FROM builds WHERE id = sites.live_build_id) <= (SELECT created_at FROM builds WHERE id = $2))`,
          [site.id, buildId]);
      });
      finished?.inc({ outcome: 'succeeded' });
      blog.info('build succeeded', { files });
      await provider.reportStatus?.({ repo: site.repo, sha: row.commit_sha, state: 'success', description: 'Docs built', ...(siteUrl && { url: siteUrl(site) }) }).catch(() => undefined);
      await gc(site.id);
    } catch (error) {
      await flush.catch(() => undefined);
      const message = scrub(error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const willRetry = !(error instanceof NonRetryableError) && job.attempts < job.maxAttempts;
      await appendLog(buildId, `${pending}\nERROR: ${message}\n`).catch(() => undefined);
      if (!willRetry) {
        await db.query(`UPDATE builds SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1`, [buildId, message, clock()]);
        finished?.inc({ outcome: 'failed' });
        await provider.reportStatus?.({ repo: site.repo, sha: row.commit_sha, state: 'failure', description: message.slice(0, 120) }).catch(() => undefined);
      }
      blog.error('build failed', { error: message, willRetry });
      throw error;
    } finally {
      duration?.observe((Date.now() - started) / 1000);
      await rm(work, { recursive: true, force: true });
    }
  }

  /** Delete the stored files of builds beyond the newest `keep`, never the live one. */
  async function gc(siteId: string, keep = keepBuilds): Promise<number> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM builds WHERE site_id = $1 AND status IN ('succeeded','failed')
         AND id IS DISTINCT FROM (SELECT live_build_id FROM sites WHERE id = $1)
       ORDER BY created_at DESC OFFSET $2`, [siteId, keep]);
    for (const { id } of rows) {
      for (const key of await storage.list(`builds/${id}/`)) await storage.delete(key);
      await db.query(`UPDATE builds SET artifact_key = NULL, index_key = NULL WHERE id = $1`, [id]);
    }
    return rows.length;
  }

  return {
    request, handle, gc,
    queue: BUILD_QUEUE,

    async list(actor: Actor, siteId: string, limit = 30): Promise<Build[]> {
      await sites.get(actor, siteId, 'site.read');
      return (await db.query<BuildRow>('SELECT * FROM builds WHERE site_id = $1 ORDER BY created_at DESC LIMIT $2', [siteId, Math.min(limit, 100)])).rows.map(toBuild);
    },
    async get(actor: Actor, buildId: string): Promise<Build & { log: string }> {
      const row = (await db.query<BuildRow>('SELECT * FROM builds WHERE id = $1', [buildId])).rows[0];
      if (!row) throw notFound('No such build.');
      await sites.get(actor, row.site_id, 'site.read');
      return { ...toBuild(row), log: row.log ?? '' };
    },
    /** Queue a rebuild of the default branch's current head. */
    async rebuild(actor: Actor, siteId: string): Promise<{ buildId: string }> {
      const site = await sites.get(actor, siteId, 'site.build');
      const provider = providers[site.provider];
      if (!provider) throw notFound(`${site.provider} is not configured.`);
      const sha = await provider.getBranchSha(site.repo, site.defaultBranch);
      // A manual rebuild is always new: it carries a time stamp so it is not folded into an earlier build of the same commit.
      const r = await request(site, sha, `refs/heads/${site.defaultBranch}`, `manual-${clock().getTime()}`);
      return { buildId: r.buildId };
    },

    /** The stored index of the live build, for the agent and the editor. */
    async liveIndex(siteId: string): Promise<unknown | undefined> {
      const { rows } = await db.query<{ index_key: string | null }>(
        'SELECT b.index_key FROM sites s JOIN builds b ON b.id = s.live_build_id WHERE s.id = $1', [siteId]);
      const key = rows[0]?.index_key;
      const bytes = key ? await storage.get(key) : undefined;
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    },

    /**
     * Serve one file of the live build. Pretty URLs work (`/guide` finds `guide.html` or `guide/index.html`), and a
     * missing page returns the build's `404.html`. Call it only from a host that is **not** the platform's own origin.
     */
    async serve(slug: string, rawPath: string): Promise<Response> {
      const { rows } = await db.query<{ id: string }>(
        'SELECT s.live_build_id AS id FROM sites s WHERE s.slug = $1 AND s.live_build_id IS NOT NULL', [slug]);
      if (!rows[0]) return new Response('This site has not been published yet.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      let path: string;
      try {
        path = posix.normalize(decodeURIComponent(rawPath.split('?')[0]!)).replace(/^\/+/, '');
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      if (path.split('/').includes('..') || path.includes('\0')) return new Response('Bad request', { status: 400 });
      const base = `builds/${rows[0].id}/site/`;
      const candidates = !path || path.endsWith('/') ? [`${path}index.html`] : extname(path) ? [path] : [`${path}.html`, `${path}/index.html`];
      for (const rel of candidates) {
        const bytes = await storage.get(`${base}${rel}`).catch(() => undefined);
        if (bytes) return fileResponse(rel, bytes, 200);
      }
      const notFoundPage = await storage.get(`${base}404.html`);
      return notFoundPage ? fileResponse('404.html', notFoundPage, 404) : new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    },
  };
}

function fileResponse(rel: string, bytes: Uint8Array, status: number): Response {
  const immutable = rel.startsWith('_next/static/');
  return new Response(bytes as unknown as NonNullable<ConstructorParameters<typeof Response>[0]>, {
    status,
    headers: {
      'content-type': contentType(rel),
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

async function detectPackageManager(cwd: string): Promise<{ cmd: string; install: string[] }> {
  const has = (f: string) => stat(join(cwd, f)).then(() => true, () => false);
  if (await has('pnpm-lock.yaml')) return { cmd: 'pnpm', install: ['install', '--frozen-lockfile', '--ignore-scripts'] };
  if (await has('yarn.lock')) return { cmd: 'yarn', install: ['install', '--frozen-lockfile', '--ignore-scripts'] };
  if (await has('package-lock.json')) return { cmd: 'npm', install: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'] };
  return { cmd: 'npm', install: ['install', '--ignore-scripts', '--no-audit', '--no-fund'] };
}

export type Builds = ReturnType<typeof createBuilds>;
export { apiSource };
