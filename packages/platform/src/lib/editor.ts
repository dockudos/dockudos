import { randomBytes, randomUUID } from 'node:crypto';
import { DocsConfigError, parseConfig, parseFrontmatter, sanitizeSvg } from '@dockudos/core';
import type { Actor, Auth } from './auth.ts';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { badRequest, conflict, forbidden, notFound } from './errors.ts';
import type { FileChange, GitProvider, ProviderId } from './git/types.ts';
import { GitConflictError } from './git/types.ts';
import type { Site, Sites } from './sites.ts';
import type { ObjectStorage } from './storage.ts';

export type PathKind = 'config' | 'doc' | 'media';
const DOC = /^docs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.mdx?$/;
const MEDIA = /^public\/media\/[A-Za-z0-9._-]+$/;
const MEDIA_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'mp4'] as const;
const MAX_DOC = 1024 * 1024;
const MAX_MEDIA = 10 * 1024 * 1024;
const PAGE_ID = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;

/** What the editor may touch. Everything else in the repository (code, scripts, CI) is out of reach. */
export function classifyPath(path: string): PathKind | undefined {
  if (path.includes('..') || path.includes('//')) return undefined;
  if (path === 'docs.json') return 'config';
  if (DOC.test(path) && !path.split('/').some((p) => p.startsWith('.'))) return 'doc';
  if (MEDIA.test(path) && !path.split('/').at(-1)!.startsWith('.')) return 'media';
  return undefined;
}

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Identify an upload by its first bytes, never by the name or content type the browser claims. */
export function sniffMedia(bytes: Uint8Array): { ext: (typeof MEDIA_EXT)[number]; type: string } | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return { ext: 'png', type: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (ascii(bytes, 0, 4) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (ascii(bytes, 0, 4) === '%PDF') return { ext: 'pdf', type: 'application/pdf' };
  if (ascii(bytes, 4, 8) === 'ftyp') return { ext: 'mp4', type: 'video/mp4' };
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(dec(bytes.slice(0, 600)))) return { ext: 'svg', type: 'image/svg+xml' };
  return undefined;
}

export interface SaveInput {
  /** The head commit the editor loaded its files from. Edits are checked against what changed since. */
  baseSha: string;
  message: string;
  title?: string;
  changes: { path: string; content?: string; delete?: boolean }[];
  /** Uploaded media to commit alongside (ids from `uploadMedia`). */
  uploads?: string[];
  /** `pr` (default) opens a pull request; `direct` commits to the default branch and needs the admin role. */
  mode?: 'pr' | 'direct';
}

export interface SaveResult {
  mode: 'pr' | 'direct';
  branch: string;
  headSha: string;
  prUrl?: string;
  warnings: string[];
}

export type PageOperation =
  | { type: 'create'; id: string; title: string; group?: string }
  | { type: 'delete'; id: string }
  | { type: 'rename'; from: string; to: string };

export interface EditorOptions {
  db: Db;
  auth: Auth;
  sites: Sites;
  providers: Partial<Record<ProviderId, GitProvider>>;
  storage: ObjectStorage;
  clock?: Clock;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'editor';

type NavNode = string | { pages?: NavNode[]; groups?: NavNode[]; [k: string]: unknown };

/** Page ids a docs.json sidebar refers to. */
function navPages(nav: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const o = n as { pages?: unknown; groups?: unknown };
      walk(o.pages);
      walk(o.groups);
    }
  };
  walk(nav);
  return out;
}

function mapNav(nav: unknown, fn: (id: string) => string | null): unknown {
  if (typeof nav === 'string') return fn(nav);
  if (Array.isArray(nav)) return nav.map((n) => mapNav(n, fn)).filter((n) => n !== null);
  if (nav && typeof nav === 'object') {
    const o = { ...(nav as Record<string, unknown>) };
    if ('pages' in o) o['pages'] = mapNav(o['pages'], fn);
    if ('groups' in o) o['groups'] = mapNav(o['groups'], fn);
    return o;
  }
  return nav;
}

export function createEditor({ db, auth, sites, providers, storage, clock = systemClock }: EditorOptions) {
  const providerOf = (site: Site) => {
    const p = providers[site.provider];
    if (!p) throw notFound(`${site.provider} is not configured.`);
    return p;
  };
  const repoPath = (site: Site, rel: string) => (site.docsDir ? `${site.docsDir}/${rel}` : rel);

  async function readText(site: Site, rel: string, ref: string): Promise<{ text: string; sha: string } | undefined> {
    const f = await providerOf(site).readFile(site.repo, repoPath(site, rel), ref);
    return f ? { text: dec(f.content), sha: f.sha } : undefined;
  }

  /** Check what would be committed. Throws 400 with every problem found; returns non-fatal warnings. */
  async function validate(site: Site, ref: string, changes: FileChange[]): Promise<string[]> {
    const problems: string[] = [];
    const warnings: string[] = [];
    let config: unknown;
    for (const c of changes) {
      const kind = classifyPath(c.path);
      if (!kind) {
        problems.push(`${c.path}: the editor can change docs.json, docs/**/*.md(x) and public/media/* only`);
        continue;
      }
      if (c.delete) {
        if (kind === 'config') problems.push('docs.json cannot be deleted');
        continue;
      }
      const bytes = typeof c.content === 'string' ? new TextEncoder().encode(c.content) : (c.content ?? new Uint8Array());
      if (kind !== 'media' && bytes.length > MAX_DOC) problems.push(`${c.path}: larger than 1 MB`);
      if (kind === 'doc') {
        try {
          parseFrontmatter(dec(bytes), c.path);
        } catch (e) {
          problems.push(`${c.path}: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (kind === 'config') {
        try {
          config = JSON.parse(dec(bytes));
          parseConfig(config, 'docs.json');
        } catch (e) {
          if (e instanceof DocsConfigError) problems.push(...e.issues.map((i) => `docs.json: ${i}`));
          else problems.push(`docs.json: not valid JSON (${(e as Error).message})`);
          config = undefined;
        }
      }
    }
    if (problems.length) throw badRequest(problems.join('\n'), 'invalid_content');

    if (config) {
      const have = new Set((await providerOf(site).listFiles(site.repo, ref, repoPath(site, 'docs'))).map((p) => p.slice(repoPath(site, '').length)));
      for (const c of changes) if (c.delete) have.delete(c.path); else have.add(c.path);
      for (const id of navPages((config as { navigation?: unknown }).navigation))
        if (![`docs/${id}.mdx`, `docs/${id}.md`, `docs/${id}/index.mdx`, `docs/${id}/index.md`].some((f) => have.has(f)))
          warnings.push(`docs.json lists "${id}" but no page file exists for it`);
    }
    return warnings;
  }

  async function mediaChanges(site: Site, actor: Actor, ids: string[]): Promise<FileChange[]> {
    const out: FileChange[] = [];
    for (const id of ids) {
      const { rows } = await db.query<{ key: string; name: string }>('SELECT key, name FROM uploads WHERE id = $1 AND site_id = $2', [id, site.id]);
      if (!rows[0]) throw badRequest('Unknown upload.');
      const bytes = await storage.get(rows[0].key);
      if (!bytes) throw badRequest('The upload is gone; upload it again.');
      out.push({ path: `public/media/${rows[0].name}`, content: bytes });
    }
    void actor;
    return out;
  }

  return {
    classifyPath,

    /** The editable files of a site and the commit they were read at. */
    async tree(actor: Actor, siteId: string) {
      const site = await sites.get(actor, siteId, 'site.read');
      const provider = providerOf(site);
      const headSha = await provider.getBranchSha(site.repo, site.defaultBranch);
      const root = repoPath(site, '');
      const files = (await provider.listFiles(site.repo, headSha, site.docsDir))
        .map((p) => p.slice(root.length))
        .flatMap((path) => { const kind = classifyPath(path); return kind ? [{ path, kind }] : []; });
      return { headSha, branch: site.defaultBranch, files };
    },

    async read(actor: Actor, siteId: string, path: string, ref?: string) {
      const site = await sites.get(actor, siteId, 'site.read');
      const kind = classifyPath(path);
      if (!kind || kind === 'media') throw badRequest('Only docs.json and Markdown pages can be opened in the editor.');
      const sha = ref ?? (await providerOf(site).getBranchSha(site.repo, site.defaultBranch));
      const file = await readText(site, path, sha);
      if (!file) throw notFound('No such file.');
      return { path, content: file.text, sha: file.sha, headSha: sha };
    },

    /**
     * Save edits as a branch and pull request (or, for admins, straight to the default branch). Files stay the source
     * of truth: this only ever creates commits. If a file changed upstream since `baseSha` and the editor's version differs
     * from the upstream one, nothing is written and the conflicting files come back so the person can merge.
     */
    async save(actor: Actor, siteId: string, input: SaveInput): Promise<SaveResult> {
      const mode = input.mode ?? 'pr';
      const site = await sites.get(actor, siteId, 'site.edit');
      if (mode === 'direct') await auth.require(actor, site.teamId, 'site.manage');
      const message = input.message?.trim();
      if (!message || message.length > 200) throw badRequest('A commit message is 1 to 200 characters.');
      if (!Array.isArray(input.changes) || input.changes.length + (input.uploads?.length ?? 0) === 0) throw badRequest('Nothing to save.');
      if (input.changes.length > 200) throw badRequest('At most 200 files per save.');
      const provider = providerOf(site);
      const head = await provider.getBranchSha(site.repo, site.defaultBranch);

      const changes: FileChange[] = input.changes.map((c) => ({ path: c.path, ...(c.delete ? { delete: true } : { content: c.content ?? '' }) }));
      const seen = new Set<string>();
      for (const c of changes) {
        if (seen.has(c.path)) throw badRequest(`${c.path} appears twice.`);
        seen.add(c.path);
      }
      const warnings = await validate(site, head, changes);
      changes.push(...(await mediaChanges(site, actor, input.uploads ?? [])));

      if (input.baseSha !== head) {
        const conflicts: { path: string; theirs: string | null }[] = [];
        for (const c of changes) {
          if (classifyPath(c.path) === 'media') continue;
          const [then, now] = await Promise.all([readText(site, c.path, input.baseSha), readText(site, c.path, head)]);
          if (then?.sha === now?.sha) continue; // nobody else touched it
          const mine = c.delete ? undefined : String(c.content);
          if (mine === now?.text) continue; // we agree
          conflicts.push({ path: c.path, theirs: now?.text ?? null });
        }
        if (conflicts.length) throw conflict(`${conflicts.length} file(s) changed since you opened them.`, 'edit_conflict', { conflicts, headSha: head });
      }

      const repoChanges = changes.map((c) => ({ ...c, path: repoPath(site, c.path) }));
      const who = actor.type === 'user' ? actor.user.name ?? actor.user.email ?? 'someone' : `API key ${actor.key.name}`;
      const stamp = clock().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      let branch = site.defaultBranch;
      let headSha: string;
      let prUrl: string | undefined;
      try {
        if (mode === 'direct') {
          headSha = await provider.commit({ repo: site.repo, branch, message, changes: repoChanges, expectedHeadSha: head });
        } else {
          branch = `dockudos/edit-${slug(who)}-${stamp}-${randomBytes(2).toString('hex')}`;
          await provider.createBranch(site.repo, branch, head);
          headSha = await provider.commit({ repo: site.repo, branch, message, changes: repoChanges });
          const pr = await provider.openPullRequest({
            repo: site.repo, head: branch, base: site.defaultBranch, title: input.title?.trim() || message,
            body: `Edited with the dockudos editor by ${who}.\n\n${changes.map((c) => `- ${c.delete ? 'delete' : 'update'} \`${c.path}\``).join('\n')}\n\nReview and merge to publish.`,
          });
          prUrl = pr.url;
        }
      } catch (e) {
        if (e instanceof GitConflictError) throw conflict('The branch moved while saving. Reload and try again.', 'branch_moved');
        throw e;
      }
      await db.query(
        'INSERT INTO edits (site_id, user_id, branch, base_sha, head_sha, pr_url, mode, files, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [siteId, actor.type === 'user' ? actor.user.id : null, branch, input.baseSha, headSha, prUrl ?? null, mode, JSON.stringify(changes.map((c) => c.path)), clock()]);
      return { mode, branch, headSha, ...(prUrl && { prUrl }), warnings };
    },

    /** Stage an image, PDF or video for the next save. The type is decided from the bytes; SVGs are sanitized. */
    async uploadMedia(actor: Actor, siteId: string, filename: string, input: Uint8Array) {
      const site = await sites.get(actor, siteId, 'site.edit');
      if (input.length > MAX_MEDIA) throw badRequest('Media files are at most 10 MB.');
      const kind = sniffMedia(input);
      if (!kind) throw badRequest('Unsupported file. Upload a PNG, JPEG, GIF, WebP, SVG, PDF or MP4.');
      let bytes = input;
      if (kind.ext === 'svg') {
        try {
          const clean = sanitizeSvg(dec(input));
          const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          const attrs = Object.entries(clean.attrs).map(([k, v]) => ` ${k.replace(/[^a-zA-Z-]/g, '')}="${esc(v)}"`).join('');
          const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(clean.viewBox)}"${attrs}>${clean.body}</svg>`;
          // The sanitizer already drops these; checking the result again costs nothing.
          if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(out)) throw new Error('scripts are not allowed');
          bytes = new TextEncoder().encode(out);
        } catch (e) {
          throw badRequest(`The SVG was refused: ${(e as Error).message}`);
        }
      }
      const base = filename.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
      const id = randomUUID();
      const name = `${id.slice(0, 8)}-${base}.${kind.ext}`;
      const key = `uploads/${site.id}/${id}/${name}`;
      await storage.put(key, bytes, kind.type);
      await db.query('INSERT INTO uploads (id, site_id, key, name, content_type, size, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, siteId, key, name, kind.type, bytes.length, actor.type === 'user' ? actor.user.id : null, clock()]);
      const path = `/media/${name}`;
      return { id, path, contentType: kind.type, size: bytes.length, markdown: kind.type.startsWith('image/') ? `![${base}](${path})` : `[${base}](${path})` };
    },

    /** The file changes for creating, deleting or renaming a page (and its sidebar entry); pass them to `save`. */
    async planPage(actor: Actor, siteId: string, op: PageOperation): Promise<{ changes: { path: string; content?: string; delete?: boolean }[] }> {
      const site = await sites.get(actor, siteId, 'site.edit');
      const head = await providerOf(site).getBranchSha(site.repo, site.defaultBranch);
      const cfgFile = await readText(site, 'docs.json', head);
      if (!cfgFile) throw notFound('This site has no docs.json.');
      const cfg = JSON.parse(cfgFile.text) as { navigation?: NavNode[]; redirects?: { source: string; destination: string; permanent?: boolean }[] };
      const ids = [op.type === 'rename' ? op.to : op.type === 'create' ? op.id : undefined, op.type === 'rename' ? op.from : op.type === 'delete' ? op.id : undefined];
      for (const id of ids) if (id !== undefined && !PAGE_ID.test(id)) throw badRequest(`"${id}" is not a page id: lowercase letters, digits, "-" and "_", with "/" between folders.`);

      const fileFor = async (id: string) => {
        for (const rel of [`docs/${id}.mdx`, `docs/${id}.md`, `docs/${id}/index.mdx`, `docs/${id}/index.md`]) {
          const f = await readText(site, rel, head);
          if (f) return { rel, text: f.text };
        }
        return undefined;
      };
      const changes: { path: string; content?: string; delete?: boolean }[] = [];

      if (op.type === 'create') {
        if (await fileFor(op.id)) throw conflict(`"${op.id}" already exists.`);
        const title = op.title.trim();
        if (!title || title.length > 120 || /[\r\n]/.test(title)) throw badRequest('A title is one line of 1 to 120 characters.');
        changes.push({ path: `docs/${op.id}.mdx`, content: `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n` });
        const tabs = (cfg.navigation ??= []) as { groups?: { group: string; pages: NavNode[] }[] }[];
        const groups = tabs.flatMap((t) => t.groups ?? []);
        const group = (op.group && groups.find((g) => g.group === op.group)) || groups[0];
        if (group) group.pages.push(op.id);
        else cfg.navigation = [{ tab: 'Docs', groups: [{ group: 'Pages', pages: [op.id] }] }] as NavNode[];
      } else if (op.type === 'delete') {
        const f = await fileFor(op.id);
        if (!f) throw notFound(`No page "${op.id}".`);
        changes.push({ path: f.rel, delete: true });
        cfg.navigation = mapNav(cfg.navigation, (id) => (id === op.id ? null : id)) as NavNode[];
      } else {
        const f = await fileFor(op.from);
        if (!f) throw notFound(`No page "${op.from}".`);
        if (await fileFor(op.to)) throw conflict(`"${op.to}" already exists.`);
        const ext = f.rel.endsWith('.md') ? 'md' : 'mdx';
        changes.push({ path: f.rel, delete: true }, { path: `docs/${op.to}.${ext}`, content: f.text });
        cfg.navigation = mapNav(cfg.navigation, (id) => (id === op.from ? op.to : id)) as NavNode[];
        cfg.redirects = [...(cfg.redirects ?? []).filter((r) => r.source !== `/${op.from}`), { source: `/${op.from}`, destination: `/${op.to}`, permanent: true }];
      }
      changes.push({ path: 'docs.json', content: `${JSON.stringify(cfg, null, 2)}\n` });
      return { changes };
    },

    /** Replace `docs.json` after checking it against the schema; the form editor posts the whole object. */
    async validateConfig(actor: Actor, siteId: string, json: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
      await sites.get(actor, siteId, 'site.edit');
      try {
        parseConfig(JSON.parse(json), 'docs.json');
        return { ok: true };
      } catch (e) {
        return { ok: false, problems: e instanceof DocsConfigError ? [...e.issues] : [`Not valid JSON: ${(e as Error).message}`] };
      }
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
export { forbidden };
