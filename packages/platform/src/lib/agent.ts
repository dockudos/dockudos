import { randomBytes } from 'node:crypto';
import { type ContentIndex, extractLinks, type LLMProvider, resolveDocLink } from '@dockudos/core';
import type { Actor } from './auth.ts';
import type { Builds } from './builds.ts';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { badRequest, notFound } from './errors.ts';
import { type AffectedPage, isRelevantCodeFile, mapChangesToPages } from './agent-map.ts';
import { checkDraft, describeChanges, draftEdit } from './agent-draft.ts';
import type { ChangedFile, FileChange, GitProvider, ProviderId } from './git/types.ts';
import { type Logger, silentLogger } from './logger.ts';
import type { MetricsRegistry } from './metrics.ts';
import { type Job, NonRetryableError, type Queue } from './queue.ts';
import type { Site, Sites } from './sites.ts';
import { classifyPath } from './editor.ts';

export const AGENT_QUEUE = 'agent';
export const AGENT_BRANCH_PREFIX = 'dockudos/agent-';
const MAX_PAGES_PER_PR = 5;

export interface CodeRepo { provider: ProviderId; repo: string; branch?: string }

/**
 * The only way the agent writes to a repository: a new branch under `dockudos/agent-` and a pull request into the
 * default branch. There is no method that commits to an existing branch, no force, no merge. The invariant "the agent
 * never publishes" is this object's whole interface, so it holds no matter what the model returns.
 */
export function createAgentGit(provider: GitProvider, repo: string, defaultBranch: string) {
  return {
    async openPullRequest(input: { baseSha: string; hint: string; message: string; changes: FileChange[]; title: string; body: string }): Promise<{ branch: string; url: string; headSha: string }> {
      const branch = `${AGENT_BRANCH_PREFIX}${input.hint.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase() || 'change'}-${randomBytes(3).toString('hex')}`;
      if (branch === defaultBranch || !branch.startsWith(AGENT_BRANCH_PREFIX)) throw new Error('The agent only writes to its own branches.');
      await provider.createBranch(repo, branch, input.baseSha);
      const headSha = await provider.commit({ repo, branch, message: input.message, changes: input.changes });
      const pr = await provider.openPullRequest({ repo, head: branch, base: defaultBranch, title: input.title, body: input.body });
      return { branch, url: pr.url, headSha };
    },
  };
}

export interface AgentRun {
  id: string;
  siteId: string;
  trigger: string;
  codeRepo?: string;
  baseSha?: string;
  headSha?: string;
  status: 'running' | 'opened' | 'flagged' | 'no-changes' | 'failed';
  branch?: string;
  prUrl?: string;
  flagged: { path: string; reasons: string[]; outcome: string }[];
  error?: string;
  createdAt: Date;
}

interface RunRow {
  id: string; site_id: string; trigger: string; code_repo: string | null; base_sha: string | null; head_sha: string | null;
  status: AgentRun['status']; branch: string | null; pr_url: string | null; flagged: AgentRun['flagged']; error: string | null; created_at: Date;
}
const toRun = (r: RunRow): AgentRun => ({
  id: r.id, siteId: r.site_id, trigger: r.trigger, status: r.status, flagged: r.flagged, createdAt: r.created_at,
  ...(r.code_repo && { codeRepo: r.code_repo }), ...(r.base_sha && { baseSha: r.base_sha }), ...(r.head_sha && { headSha: r.head_sha }),
  ...(r.branch && { branch: r.branch }), ...(r.pr_url && { prUrl: r.pr_url }), ...(r.error && { error: r.error }),
});

export interface AgentOptions {
  db: Db;
  sites: Sites;
  builds: Builds;
  queue: Queue;
  providers: Partial<Record<ProviderId, GitProvider>>;
  /** The site owner's own model (bring your own key). Without one the agent still finds and reports affected pages. */
  llm?: LLMProvider;
  clock?: Clock;
  log?: Logger;
  metrics?: MetricsRegistry;
}

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|php|swift|ya?ml|json|toml|sql|proto|graphql|sh)$/i;

function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / Math.max(1, new Set([...ta, ...tb]).size);
  // Edit-distance ratio catches typos and small renames that share no whole word ("authn" vs "authentication").
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j++) d[0]![j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
  const lev = 1 - d[x.length]![y.length]! / Math.max(x.length, y.length, 1);
  return Math.max(jaccard, lev);
}

export function createAgent({ db, sites, builds, queue, providers, llm, clock = systemClock, log = silentLogger, metrics }: AgentOptions) {
  const runs = metrics?.counter('dockudos_agent_runs_total', 'Agent runs, by outcome');

  async function settings(siteId: string): Promise<{ enabled: boolean; codeRepos: CodeRepo[] }> {
    const { rows } = await db.query<{ agent_enabled: boolean; code_repos: CodeRepo[] }>('SELECT agent_enabled, code_repos FROM site_settings WHERE site_id = $1', [siteId]);
    return { enabled: rows[0]?.agent_enabled ?? false, codeRepos: rows[0]?.code_repos ?? [] };
  }

  async function startRun(siteId: string, trigger: string, extra: { codeRepo?: string; baseSha?: string; headSha?: string } = {}) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO agent_runs (site_id, trigger, code_repo, base_sha, head_sha, status, created_at) VALUES ($1,$2,$3,$4,$5,'running',$6) RETURNING id`,
      [siteId, trigger, extra.codeRepo ?? null, extra.baseSha ?? null, extra.headSha ?? null, clock()]);
    return rows[0]!.id;
  }
  async function finish(id: string, status: AgentRun['status'], extra: { branch?: string; prUrl?: string; flagged?: AgentRun['flagged']; error?: string } = {}) {
    await db.query('UPDATE agent_runs SET status = $2, branch = $3, pr_url = $4, flagged = $5, error = $6 WHERE id = $1',
      [id, status, extra.branch ?? null, extra.prUrl ?? null, JSON.stringify(extra.flagged ?? []), extra.error ?? null]);
    runs?.inc({ outcome: status });
  }

  /** Where a page's source lives in the docs repository. */
  async function sourceOf(site: Site, provider: GitProvider, headSha: string, pagePath: string): Promise<{ rel: string; text: string } | undefined> {
    const id = pagePath.replace(/^\/+/, '') || 'index';
    for (const rel of [`docs/${id}.mdx`, `docs/${id}.md`, `docs/${id}/index.mdx`, `docs/${id}/index.md`]) {
      const f = await provider.readFile(site.repo, site.docsDir ? `${site.docsDir}/${rel}` : rel, headSha);
      if (f) return { rel, text: dec(f.content) };
    }
    return undefined;
  }

  async function docsContext(siteId: string) {
    const site = await sites.internal(siteId);
    const provider = providers[site.provider];
    if (!provider) throw new NonRetryableError(`${site.provider} is not configured.`);
    const index = (await builds.liveIndex(siteId)) as ContentIndex | undefined;
    if (!index?.pages) throw new NonRetryableError('The site has no published build with an index yet. Build it first.');
    const headSha = await provider.getBranchSha(site.repo, site.defaultBranch);
    return { site, provider, index, headSha, git: createAgentGit(provider, site.repo, site.defaultBranch) };
  }

  /** Draft edits for pages and open one pull request. Shared by the code-change flow and the automations. */
  async function proposeEdits(ctx: Awaited<ReturnType<typeof docsContext>>, candidates: { page: { path: string; title: string }; reasons: string[]; changes?: ChangedFile[]; finding?: string }[], intro: string, hint: string, signal?: AbortSignal) {
    const flagged: AgentRun['flagged'] = [];
    const edits: { file: string; content: string; title: string; rationale: string }[] = [];
    for (const c of candidates.slice(0, MAX_PAGES_PER_PR)) {
      const src = await sourceOf(ctx.site, ctx.provider, ctx.headSha, c.page.path);
      if (!src) { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: 'source file not found' }); continue; }
      if (!llm) { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: 'no model configured' }); continue; }
      let draft;
      try {
        draft = await draftEdit({ llm, page: { ...c.page, source: src.text }, ...(c.changes && { changes: c.changes }), ...(c.finding && { finding: c.finding }), reasons: c.reasons, ...(signal && { signal }) });
      } catch (error) {
        flagged.push({ path: c.page.path, reasons: c.reasons, outcome: `model error: ${(error as Error).message.slice(0, 120)}` });
        continue;
      }
      if (!draft) { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: 'model reply not understood' }); continue; }
      if (draft.decision === 'none') { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: `no change needed: ${draft.rationale}` }); continue; }
      const check = checkDraft(src.text, draft.content, src.rel);
      if (!check.ok) { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: `edit rejected: ${check.reason}` }); continue; }
      if (!classifyPath(src.rel)) { flagged.push({ path: c.page.path, reasons: c.reasons, outcome: 'file is not editable' }); continue; }
      edits.push({ file: src.rel, content: draft.content, title: c.page.title, rationale: draft.rationale });
      flagged.push({ path: c.page.path, reasons: c.reasons, outcome: 'edit proposed' });
    }
    if (!edits.length) return { flagged };
    const body = [
      intro,
      '',
      '### Proposed edits',
      ...edits.map((e) => `- **${e.title}** (\`${e.file}\`): ${e.rationale || 'updated to match the code'}`),
      '',
      '_Opened by the dockudos agent. It only proposes changes: nothing is published until a person reviews and merges this pull request._',
    ].join('\n');
    const pr = await ctx.git.openPullRequest({
      baseSha: ctx.headSha, hint, message: `docs: update ${edits.length} page${edits.length === 1 ? '' : 's'} (dockudos agent)`,
      title: `docs: ${edits.length === 1 ? `update ${edits[0]!.title}` : `update ${edits.length} pages`} to match code changes`, body,
      changes: edits.map((e) => ({ path: ctx.site.docsDir ? `${ctx.site.docsDir}/${e.file}` : e.file, content: e.content })),
    });
    return { flagged, pr };
  }

  async function runCodeChange(job: Job): Promise<void> {
    const { siteId, codeRepo, provider: cp, baseSha, headSha, trigger = 'code-change' } = job.payload as { siteId: string; codeRepo: string; provider: ProviderId; baseSha: string; headSha: string; trigger?: string };
    const runId = await startRun(siteId, trigger, { codeRepo, baseSha, headSha });
    try {
      const ctx = await docsContext(siteId);
      const codeProvider = providers[cp];
      if (!codeProvider) throw new NonRetryableError(`${cp} is not configured.`);
      const changed = (await codeProvider.compare(codeRepo, baseSha, headSha)).filter((f) => isRelevantCodeFile(f.path));
      if (!changed.length) return finish(runId, 'no-changes');
      const affected = mapChangesToPages(ctx.index, changed);
      if (!affected.length) return finish(runId, 'no-changes');
      const { flagged, pr } = await proposeEdits(ctx, affected.map((a: AffectedPage) => ({ page: a, reasons: a.reasons, changes: changed })),
        `The code in \`${codeRepo}\` changed (\`${baseSha.slice(0, 8)}...${headSha.slice(0, 8)}\`):\n\n${describeChanges(changed)}`, headSha);
      if (pr) await finish(runId, 'opened', { branch: pr.branch, prUrl: pr.url, flagged });
      else await finish(runId, 'flagged', { flagged });
    } catch (error) {
      await finish(runId, 'failed', { error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  }

  /** Links to pages that do not exist, with a mechanical fix when one page is clearly what the author meant. */
  async function runBrokenLinks(job: Job): Promise<void> {
    const { siteId } = job.payload as { siteId: string };
    const runId = await startRun(siteId, 'broken-links');
    try {
      const ctx = await docsContext(siteId);
      const pages = new Map(ctx.index.pages.map((p) => [p.path, p]));
      const cfgFile = await ctx.provider.readFile(ctx.site.repo, ctx.site.docsDir ? `${ctx.site.docsDir}/docs.json` : 'docs.json', ctx.headSha);
      const redirects = new Set<string>(((cfgFile && (JSON.parse(dec(cfgFile.content)) as { redirects?: { source: string }[] }).redirects) || []).map((r) => r.source.replace(/\/+$/, '') || '/'));
      const flagged: AgentRun['flagged'] = [];
      const fixes = new Map<string, { content: string; title: string; n: number }>();
      for (const page of ctx.index.pages) {
        const src = await sourceOf(ctx.site, ctx.provider, ctx.headSha, page.path);
        if (!src) continue;
        let text = src.text;
        let fixed = 0;
        for (const link of extractLinks(src.text)) {
          if (link.kind !== 'link') continue;
          const r = resolveDocLink(src.rel.replace(/^docs\//, ''), link.href);
          if (r.kind !== 'internal') continue;
          const target = pages.get(r.path === '/' ? '/' : r.path.replace(/\/+$/, ''));
          const ok = target ? !r.hash || target.headings.some((h) => h.id === r.hash) : redirects.has(r.path);
          if (ok) continue;
          if (target) { flagged.push({ path: page.path, reasons: [`line ${link.line}: #${r.hash} is not a heading on ${r.path}`], outcome: 'needs a person' }); continue; }
          const best = [...pages.keys()].map((p) => [p, similarity(r.path, p)] as const).sort((a, b) => b[1] - a[1]);
          if (best[0] && best[0][1] >= 0.75 && (!best[1] || best[0][1] - best[1][1] >= 0.1)) {
            const to = best[0][0] + (r.hash ? `#${r.hash}` : '');
            const next = text.split(link.href).join(to);
            if (next !== text) { text = next; fixed++; flagged.push({ path: page.path, reasons: [`line ${link.line}: ${link.href} does not exist`], outcome: `relinked to ${to}` }); continue; }
          }
          flagged.push({ path: page.path, reasons: [`line ${link.line}: ${link.href} does not exist`], outcome: 'needs a person' });
        }
        if (fixed) fixes.set(src.rel, { content: text, title: page.title, n: fixed });
      }
      if (!fixes.size) return finish(runId, flagged.length ? 'flagged' : 'no-changes', { flagged });
      const pr = await ctx.git.openPullRequest({
        baseSha: ctx.headSha, hint: 'links', message: 'docs: fix broken links (dockudos agent)', title: `docs: fix ${[...fixes.values()].reduce((n, f) => n + f.n, 0)} broken link(s)`,
        body: `Scheduled link check found links to pages that do not exist, and each had one clearly matching page.\n\n${flagged.map((f) => `- \`${f.path}\` ${f.reasons[0]}: ${f.outcome}`).join('\n')}\n\n_Opened by the dockudos agent. Review before merging._`,
        changes: [...fixes].map(([file, f]) => ({ path: ctx.site.docsDir ? `${ctx.site.docsDir}/${file}` : file, content: f.content })),
      });
      await finish(runId, 'opened', { branch: pr.branch, prUrl: pr.url, flagged });
    } catch (error) {
      await finish(runId, 'failed', { error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  }

  /** Pages that name environment variables, flags or functions the code no longer contains. */
  async function runOutdated(job: Job): Promise<void> {
    const { siteId } = job.payload as { siteId: string };
    const runId = await startRun(siteId, 'outdated-pages');
    try {
      const { codeRepos } = await settings(siteId);
      if (!codeRepos.length) return finish(runId, 'no-changes', { error: 'No code repositories are connected.' });
      const ctx = await docsContext(siteId);
      const corpus = new Set<string>();
      for (const cr of codeRepos) {
        const p = providers[cr.provider];
        if (!p) continue;
        const branch = cr.branch ?? (await p.getDefaultBranch(cr.repo));
        const sha = await p.getBranchSha(cr.repo, branch);
        const files = (await p.listFiles(cr.repo, sha)).filter((f) => isRelevantCodeFile(f) && SOURCE_EXT.test(f)).slice(0, 1500);
        for (let i = 0; i < files.length; i += 8)
          await Promise.all(files.slice(i, i + 8).map(async (f) => {
            const file = await p.readFile(cr.repo, f, sha);
            if (!file || file.content.length > 200_000) return;
            for (const m of dec(file.content).matchAll(/--[a-z][a-z0-9-]+|[A-Za-z_$][\w$]{3,}/g)) if (corpus.size < 600_000) corpus.add(m[0]);
          }));
      }
      const candidates: { page: { path: string; title: string }; reasons: string[]; finding: string }[] = [];
      for (const page of ctx.index.pages) {
        const src = await sourceOf(ctx.site, ctx.provider, ctx.headSha, page.path);
        if (!src) continue;
        const missing = new Set<string>();
        for (const m of src.text.matchAll(/`([^`\n]{3,60})`/g)) {
          const token = m[1]!.trim().replace(/\(\)$/, '');
          if (/^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|--[a-z][a-z0-9-]+|[a-z]+[A-Z][A-Za-z0-9]*)$/.test(token) && !corpus.has(token)) missing.add(token);
        }
        if (missing.size) candidates.push({ page: { path: page.path, title: page.title }, reasons: [`names ${[...missing].slice(0, 4).map((s) => `\`${s}\``).join(', ')}, not found in the code`], finding: `These identifiers are written on the page but do not appear anywhere in the connected code repositories at their latest commit: ${[...missing].join(', ')}. If they belong to a third-party tool, answer NO_CHANGE. If the code renamed or removed them, update the page.` });
      }
      if (!candidates.length) return finish(runId, 'no-changes');
      const { flagged, pr } = await proposeEdits(ctx, candidates, 'A scheduled check found pages that name things the code no longer contains.', 'outdated');
      if (pr) await finish(runId, 'opened', { branch: pr.branch, prUrl: pr.url, flagged });
      else await finish(runId, 'flagged', { flagged });
    } catch (error) {
      await finish(runId, 'failed', { error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  }

  return {
    queue: AGENT_QUEUE,
    settings,

    async configure(actor: Actor, siteId: string, input: { enabled?: boolean; codeRepos?: CodeRepo[] }) {
      await sites.get(actor, siteId, 'agent.manage');
      const cur = await settings(siteId);
      const codeRepos = input.codeRepos ?? cur.codeRepos;
      if (codeRepos.length > 10) throw badRequest('At most 10 code repositories.');
      for (const r of codeRepos) {
        if (!providers[r.provider]) throw badRequest(`${r.provider} is not configured on this instance.`);
        if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(r.repo)) throw badRequest(`"${r.repo}" is not a repository name.`);
      }
      await db.query(
        `INSERT INTO site_settings (site_id, agent_enabled, code_repos) VALUES ($1,$2,$3)
         ON CONFLICT (site_id) DO UPDATE SET agent_enabled = EXCLUDED.agent_enabled, code_repos = EXCLUDED.code_repos`,
        [siteId, input.enabled ?? cur.enabled, JSON.stringify(codeRepos)]);
    },

    async setAutomation(actor: Actor, siteId: string, kind: 'outdated-pages' | 'broken-links', input: { enabled: boolean; intervalHours?: number }) {
      await sites.get(actor, siteId, 'agent.manage');
      if (!['outdated-pages', 'broken-links'].includes(kind)) throw badRequest('Unknown automation.');
      const hours = input.intervalHours ?? 168;
      if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 90) throw badRequest('Interval is 1 to 2160 hours.');
      await db.query(
        `INSERT INTO automations (site_id, kind, interval_hours, enabled) VALUES ($1,$2,$3,$4)
         ON CONFLICT (site_id, kind) DO UPDATE SET interval_hours = EXCLUDED.interval_hours, enabled = EXCLUDED.enabled`, [siteId, kind, hours, input.enabled]);
    },

    /**
     * Look at each connected code repository's default branch. The first sighting only records where it is; later ones
     * queue a run for the range since the last run. Idempotent: the same head is queued once.
     */
    async watch(siteId: string): Promise<number> {
      const { enabled, codeRepos } = await settings(siteId);
      if (!enabled) return 0;
      let queued = 0;
      for (const cr of codeRepos) {
        const p = providers[cr.provider];
        if (!p) continue;
        const branch = cr.branch ?? (await p.getDefaultBranch(cr.repo));
        const head = await p.getBranchSha(cr.repo, branch);
        const last = (await db.query<{ head_sha: string }>(
          `SELECT head_sha FROM agent_runs WHERE site_id = $1 AND code_repo = $2 AND status <> 'failed' AND head_sha IS NOT NULL ORDER BY created_at DESC, seq DESC LIMIT 1`, [siteId, cr.repo])).rows[0]?.head_sha;
        if (!last) {
          const id = await startRun(siteId, 'baseline', { codeRepo: cr.repo, headSha: head });
          await finish(id, 'no-changes');
          continue;
        }
        if (last === head) continue;
        await queue.enqueue(AGENT_QUEUE, { kind: 'code-change', siteId, provider: cr.provider, codeRepo: cr.repo, baseSha: last, headSha: head }, { idempotencyKey: `code:${siteId}:${cr.repo}:${head}`, maxAttempts: 2 });
        queued++;
      }
      return queued;
    },

    /** Queue every enabled automation whose interval has passed. Call every few minutes. */
    async tick(): Promise<number> {
      const now = clock();
      const { rows } = await db.query<{ id: string; site_id: string; kind: string; interval_hours: number; last_run_at: Date | null }>(
        `SELECT a.* FROM automations a JOIN site_settings s ON s.site_id = a.site_id
         WHERE a.enabled AND s.agent_enabled AND (a.last_run_at IS NULL OR a.last_run_at + make_interval(hours => a.interval_hours) <= $1)`, [now]);
      for (const r of rows) {
        await queue.enqueue(AGENT_QUEUE, { kind: r.kind, siteId: r.site_id }, { idempotencyKey: `auto:${r.id}:${now.toISOString().slice(0, 13)}`, maxAttempts: 2 });
        await db.query('UPDATE automations SET last_run_at = $2 WHERE id = $1', [r.id, now]);
      }
      const watched = await db.query<{ site_id: string }>('SELECT site_id FROM site_settings WHERE agent_enabled');
      for (const w of watched.rows) await this.watch(w.site_id).catch((e) => log.warn('watch failed', { site: w.site_id, error: e }));
      return rows.length;
    },

    /** Run now, from the dashboard: queue a check of the current head of a code repo against the last one seen. */
    async trigger(actor: Actor, siteId: string, kind: 'watch' | 'outdated-pages' | 'broken-links') {
      await sites.get(actor, siteId, 'agent.manage');
      if (!(await settings(siteId)).enabled) throw badRequest('Turn the agent on for this site first.');
      if (kind === 'watch') return { queued: await this.watch(siteId) };
      await queue.enqueue(AGENT_QUEUE, { kind, siteId }, { idempotencyKey: `manual:${kind}:${siteId}:${clock().getTime()}`, maxAttempts: 2 });
      return { queued: 1 };
    },

    async handle(job: Job): Promise<void> {
      const kind = String(job.payload['kind']);
      if (kind === 'code-change') return runCodeChange(job);
      if (kind === 'broken-links') return runBrokenLinks(job);
      if (kind === 'outdated-pages') return runOutdated(job);
      throw new NonRetryableError(`Unknown agent job "${kind}".`);
    },

    async listRuns(actor: Actor, siteId: string, limit = 30): Promise<AgentRun[]> {
      await sites.get(actor, siteId, 'site.read');
      return (await db.query<RunRow>('SELECT * FROM agent_runs WHERE site_id = $1 ORDER BY created_at DESC, seq DESC LIMIT $2', [siteId, Math.min(limit, 100)])).rows.map(toRun);
    },
    async getRun(actor: Actor, runId: string): Promise<AgentRun> {
      const row = (await db.query<RunRow>('SELECT * FROM agent_runs WHERE id = $1', [runId])).rows[0];
      if (!row) throw notFound('No such run.');
      await sites.get(actor, row.site_id, 'site.read');
      return toRun(row);
    },
  };
}

export type Agent = ReturnType<typeof createAgent>;
