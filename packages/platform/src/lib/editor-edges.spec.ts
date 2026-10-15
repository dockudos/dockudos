import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { createEditor, sniffMedia } from './editor.ts';
import { GitConflictError } from './git/types.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

const bytes = (...head: (number | string)[]) => {
  const out = new Uint8Array(32);
  let i = 0;
  for (const h of head)
    if (typeof h === 'number') out[i++] = h;
    else for (const c of h) out[i++] = c.charCodeAt(0);
  return out;
};

describe('sniffMedia', () => {
  it.each([
    ['png', bytes(0x89, 'PNG'), 'image/png'],
    ['jpg', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['gif', bytes('GIF89a'), 'image/gif'],
    ['webp', bytes('RIFF', 0, 0, 0, 0, 'WEBP'), 'image/webp'],
    ['pdf', bytes('%PDF-1.7'), 'application/pdf'],
    ['mp4', bytes(0, 0, 0, 0x18, 'ftypisom'), 'video/mp4'],
    [
      'svg',
      new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'),
      'image/svg+xml',
    ],
    [
      'svg',
      new TextEncoder().encode(
        '  <?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
      'image/svg+xml',
    ],
  ])('recognises %s by content', (ext, data, type) => {
    expect(sniffMedia(data)).toEqual({ ext, type });
  });

  it.each([
    ['too short to tell', bytes(0x89, 'PNG').slice(0, 8)],
    ['an executable', bytes('MZ', 0x90)],
    [
      'HTML pretending to be an image',
      new TextEncoder().encode('<html><body>hello world</body></html>'),
    ],
    ['a RIFF that is not WebP', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['text', new TextEncoder().encode('just some words here')],
  ])('refuses %s', (_n, data) => {
    expect(sniffMedia(data)).toBeUndefined();
  });
});

async function setup(files: Record<string, string>) {
  const f = await createFixture(db);
  const repo = `${f.repo}-ed`;
  f.git.seed(repo, files);
  const { site } = await f.sites.create(f.actor, f.team.id, {
    name: `Ed ${repo}`,
    provider: 'github',
    repo,
  });
  const editor = createEditor({
    db,
    auth: f.auth,
    sites: f.sites,
    providers: f.providers,
    storage: f.storage,
    clock: f.clock,
  });
  const head = () => f.git.getBranchSha(repo, 'main');
  return { f, editor, site, repo, head };
}
const DOC = '---\ntitle: A\n---\n\n# A\n';

describe('a site whose provider is not configured', () => {
  it('cannot be read, listed or saved', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    delete (s.f.providers as Record<string, unknown>)['github'];
    await expect(s.editor.tree(s.f.actor, s.site.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      s.editor.read(s.f.actor, s.site.id, 'docs/a.mdx'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      s.editor.save(s.f.actor, s.site.id, {
        baseSha: 'x',
        message: 'm',
        changes: [{ path: 'docs/a.mdx', content: DOC }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('save, limits and races', () => {
  it('refuses more than 200 files in one save', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    const changes = Array.from({ length: 201 }, (_, i) => ({
      path: `docs/p${i}.mdx`,
      content: DOC,
    }));
    await expect(
      s.editor.save(s.f.actor, s.site.id, {
        baseSha: await s.head(),
        message: 'm',
        changes,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'At most 200 files per save.',
    });
  });

  it('refuses the same path twice, naming it', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    await expect(
      s.editor.save(s.f.actor, s.site.id, {
        baseSha: await s.head(),
        message: 'm',
        changes: [
          { path: 'docs/a.mdx', content: DOC },
          { path: 'docs/a.mdx', content: DOC + 'x' },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'docs/a.mdx appears twice.',
    });
  });

  it('turns a branch that moved while committing into a retryable 409', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    s.f.git.commit = async () => {
      throw new GitConflictError('moved');
    };
    await expect(
      s.editor.save(s.f.actor, s.site.id, {
        baseSha: await s.head(),
        message: 'm',
        changes: [{ path: 'docs/a.mdx', content: DOC + 'y' }],
      }),
    ).rejects.toMatchObject({ status: 409, code: 'branch_moved' });
  });

  it('passes an unexpected provider failure through unchanged', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    s.f.git.commit = async () => {
      throw new Error('GitHub 500');
    };
    await expect(
      s.editor.save(s.f.actor, s.site.id, {
        baseSha: await s.head(),
        message: 'm',
        changes: [{ path: 'docs/a.mdx', content: DOC + 'y' }],
      }),
    ).rejects.toThrow('GitHub 500');
  });
});

describe('page operations on unusual sites', () => {
  it('says so when the site has no docs.json', async () => {
    const s = await setup({ 'docs/a.mdx': DOC });
    await expect(
      s.editor.planPage(s.f.actor, s.site.id, {
        type: 'create',
        id: 'b',
        title: 'B',
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: 'This site has no docs.json.',
    });
  });

  it('starts a sidebar when there is none, and lands a page in the first group when the named group is missing', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}', 'docs/a.mdx': DOC });
    const first = await s.editor.planPage(s.f.actor, s.site.id, {
      type: 'create',
      id: 'b',
      title: 'B',
    });
    const cfg = JSON.parse(
      first.changes.find((c) => c.path === 'docs.json')!.content!,
    );
    expect(cfg.navigation).toEqual([
      { tab: 'Docs', groups: [{ group: 'Pages', pages: ['b'] }] },
    ]);

    const withGroups = await setup({
      'docs.json': JSON.stringify({
        name: 'X',
        navigation: [
          {
            tab: 'T',
            groups: [
              { group: 'One', pages: ['a'] },
              { group: 'Two', pages: [] },
            ],
          },
        ],
      }),
      'docs/a.mdx': DOC,
    });
    const second = await withGroups.editor.planPage(
      withGroups.f.actor,
      withGroups.site.id,
      {
        type: 'create',
        id: 'c',
        title: 'C',
        group: 'No Such Group',
      },
    );
    const cfg2 = JSON.parse(
      second.changes.find((c) => c.path === 'docs.json')!.content!,
    );
    expect(cfg2.navigation[0].groups[0].pages).toEqual(['a', 'c']);
  });

  it('removes a deleted page from nested sidebars, whatever their shape', async () => {
    const s = await setup({
      'docs.json': JSON.stringify({
        name: 'X',
        navigation: [
          {
            tab: 'T',
            pages: ['a', { group: 'Nested', pages: ['b', 'a2'] }],
            groups: [{ group: 'G', pages: ['b', 'c'] }],
          },
        ],
      }),
      'docs/a.mdx': DOC,
      'docs/b.mdx': DOC,
      'docs/c.mdx': DOC,
      'docs/a2.mdx': DOC,
    });
    const plan = await s.editor.planPage(s.f.actor, s.site.id, {
      type: 'delete',
      id: 'b',
    });
    expect(plan.changes).toContainEqual({ path: 'docs/b.mdx', delete: true });
    const cfg = JSON.parse(
      plan.changes.find((c) => c.path === 'docs.json')!.content!,
    );
    expect(cfg.navigation[0].pages).toEqual([
      'a',
      { group: 'Nested', pages: ['a2'] },
    ]);
    expect(cfg.navigation[0].groups[0].pages).toEqual(['c']);
  });

  it('keeps the file type on rename and replaces an earlier redirect from the same page', async () => {
    const s = await setup({
      'docs.json': JSON.stringify({
        name: 'X',
        navigation: [{ tab: 'T', groups: [{ group: 'G', pages: ['old'] }] }],
        redirects: [
          { source: '/old', destination: '/elsewhere' },
          { source: '/other', destination: '/o' },
        ],
      }),
      'docs/old.md': '# Old\n',
    });
    const plan = await s.editor.planPage(s.f.actor, s.site.id, {
      type: 'rename',
      from: 'old',
      to: 'new',
    });
    expect(plan.changes).toContainEqual({
      path: 'docs/new.md',
      content: '# Old\n',
    });
    const cfg = JSON.parse(
      plan.changes.find((c) => c.path === 'docs.json')!.content!,
    );
    expect(cfg.redirects).toEqual([
      { source: '/other', destination: '/o' },
      { source: '/old', destination: '/new', permanent: true },
    ]);
  });
});

describe('validateConfig', () => {
  it('accepts a valid file, lists the schema problems of an invalid one and explains broken JSON', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}' });
    expect(
      await s.editor.validateConfig(s.f.actor, s.site.id, '{"name":"Fine"}'),
    ).toEqual({ ok: true });
    const bad = await s.editor.validateConfig(
      s.f.actor,
      s.site.id,
      '{"name": 5}',
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.length).toBeGreaterThan(0);
    const broken = await s.editor.validateConfig(
      s.f.actor,
      s.site.id,
      '{ nope',
    );
    expect(broken).toMatchObject({ ok: false });
    if (!broken.ok) expect(broken.problems[0]).toMatch(/^Not valid JSON/);
  });

  it('is only for people who may edit', async () => {
    const s = await setup({ 'docs.json': '{"name":"X"}' });
    const viewer = await s.f.auth.upsertUser({
      sub: `v-${Math.random()}`,
      email: `v${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    await expect(
      s.editor.validateConfig({ type: 'user', user: viewer }, s.site.id, '{}'),
    ).rejects.toMatchObject({ status: 403 });
  });
});
