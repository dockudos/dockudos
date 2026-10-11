import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocsConfigError } from './lib/config.ts';
import { buildNavigation } from './lib/navigation.ts';
import { parseConfig } from './lib/config.ts';
import {
  discoverPages,
  discoverSite,
  loadConfig,
  loadConfigSync,
} from './node.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-core-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('loads a valid docs.json', async () => {
    await writeFile(join(dir, 'docs.json'), JSON.stringify({ name: 'X' }));
    await expect(loadConfig(dir)).resolves.toMatchObject({ name: 'X' });
  });

  it('fails clearly when the file is missing', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/file not found/);
  });

  it('fails clearly on invalid JSON', async () => {
    await writeFile(join(dir, 'docs.json'), '{ nope');
    await expect(loadConfig(dir)).rejects.toThrow(/not valid JSON/);
  });

  it('fails with the key name on a bad config', async () => {
    await writeFile(join(dir, 'docs.json'), '{}');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(DocsConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/name:/);
  });
});

describe('discoverPages', () => {
  it('walks nested folders', async () => {
    await mkdir(join(dir, 'guides'));
    await writeFile(join(dir, 'index.mdx'), '# hi');
    await writeFile(join(dir, 'guides', 'auth.mdx'), '# auth');
    await writeFile(join(dir, 'logo.svg'), '');
    const tree = await discoverPages(dir);
    expect(tree.pages.map((p) => p.path)).toEqual(['/', '/guides/auth']);
  });
});

describe('discoverPages: frontmatter', () => {
  it('uses frontmatter, then the first heading, then the file name for the title', async () => {
    await writeFile(
      join(dir, 'a.mdx'),
      '---\ntitle: From FM\ndescription: d\nicon: star\nhidden: true\n---\n# H',
    );
    await writeFile(join(dir, 'b.mdx'), '# From heading');
    await writeFile(join(dir, 'my-page.mdx'), 'no heading');
    const tree = await discoverPages(dir);
    const byFile = Object.fromEntries(tree.pages.map((p) => [p.file, p]));
    expect(byFile['a.mdx']).toMatchObject({
      title: 'From FM',
      description: 'd',
      icon: 'star',
      hidden: true,
    });
    expect(byFile['b.mdx']?.title).toBe('From heading');
    expect(byFile['my-page.mdx']?.title).toBe('My page');
  });

  it('reports every bad file at once', async () => {
    await writeFile(join(dir, 'a.mdx'), '---\nhidden: 1\n---\n');
    await writeFile(join(dir, 'b.mdx'), '---\ntitle: ""\n---\n');
    await expect(discoverPages(dir)).rejects.toThrow(/a\.mdx[\s\S]*b\.mdx/);
  });

  it('skips dot folders, _partials and node_modules', async () => {
    await mkdir(join(dir, '.git'));
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, '.git', 'x.mdx'), '');
    await writeFile(join(dir, 'node_modules', 'y.mdx'), '');
    await mkdir(join(dir, '_snippets'));
    await writeFile(join(dir, '_snippets', 's.mdx'), '');
    await writeFile(join(dir, '_part.mdx'), '');
    await writeFile(join(dir, 'z.mdx'), '');
    expect((await discoverPages(dir)).pages.map((p) => p.file)).toEqual([
      'z.mdx',
    ]);
  });

  it('fails clearly when the docs folder is missing', async () => {
    await expect(discoverPages(join(dir, 'nope'))).rejects.toThrow(
      /Docs folder not found/,
    );
  });
});

describe('loadConfigSync', () => {
  it('loads a valid docs.json', async () => {
    await writeFile(join(dir, 'docs.json'), JSON.stringify({ name: 'X' }));
    expect(loadConfigSync(dir)).toMatchObject({ name: 'X' });
  });

  it('fails with the same messages as loadConfig', async () => {
    expect(() => loadConfigSync(dir)).toThrow(/file not found/);
    await writeFile(join(dir, 'docs.json'), '{ nope');
    expect(() => loadConfigSync(dir)).toThrow(/not valid JSON/);
    await writeFile(join(dir, 'docs.json'), '{}');
    expect(() => loadConfigSync(dir)).toThrow(/name:/);
  });
});

describe('discoverPages: layout', () => {
  it('reads a per-page layout and rejects unknown ones', async () => {
    await writeFile(join(dir, 'a.mdx'), '---\nlayout: glass\n---\n');
    expect((await discoverPages(dir)).pages[0]?.layout).toBe('glass');
    await writeFile(join(dir, 'a.mdx'), '---\nlayout: wide\n---\n');
    await expect(discoverPages(dir)).rejects.toThrow(/layout/);
  });
});

describe('discoverPages: prefix', () => {
  it('mounts pages under the prefix', async () => {
    await writeFile(join(dir, 'index.mdx'), '# H');
    await mkdir(join(dir, 'g'));
    await writeFile(join(dir, 'g', 'a.mdx'), '# A');
    const tree = await discoverPages(dir, { prefix: '/docs' });
    expect(tree.pages.map((p) => p.path)).toEqual(['/docs', '/docs/g/a']);
  });
});

describe('discoverSite', () => {
  const put = async (file: string, text = '# t') => {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), text);
  };
  const both = () =>
    parseConfig({
      name: 'X',
      versions: {
        default: 'v2',
        list: [{ name: 'v2' }, { name: 'v1', dir: 'legacy' }],
      },
      i18n: { default: 'en', locales: ['en', 'fr'] },
    });

  it('is one view for a site with neither', async () => {
    await put('index.mdx');
    const site = await discoverSite(dir, parseConfig({ name: 'X' }));
    expect(site.views).toHaveLength(1);
    expect(site.tree.pages.map((p) => p.path)).toEqual(['/']);
  });

  it('builds a tree for each version and language, with addresses and metadata', async () => {
    await put('v2/en/index.mdx');
    await put('v2/en/guides/auth.mdx', '---\ntitle: Auth\n---\nbody');
    await put(
      'v2/fr/guides/auth.mdx',
      '---\ntitle: Authentification\n---\nbody',
    );
    await put('legacy/en/guides/auth.mdx');
    const site = await discoverSite(dir, both());
    expect(site.views.map((v) => v.key)).toEqual([
      'v2/en',
      'v2/fr',
      'v1/en',
      'v1/fr',
    ]);
    const paths = (key: string) =>
      site.views.find((v) => v.key === key)?.tree.pages.map((p) => p.path);
    expect(paths('v2/en')).toEqual(['/', '/guides/auth']);
    expect(paths('v2/fr')).toEqual(['/fr', '/fr/guides/auth']);
    expect(paths('v1/en')).toEqual(['/v1/guides/auth']);
    expect(paths('v1/fr')).toEqual(['/v1/fr/guides/auth']);
    const fr = site.tree.pages.find((p) => p.path === '/fr/guides/auth');
    expect(fr).toMatchObject({
      title: 'Authentification',
      locale: 'fr',
      version: 'v2',
      rel: '/guides/auth',
      slug: ['fr', 'guides', 'auth'],
      file: 'v2/fr/guides/auth.mdx',
      contentFile: 'guides/auth.mdx',
    });
    expect(fr?.fallbackLocale).toBeUndefined();
    // every view's pages are in the site's list
    expect(site.tree.pages).toHaveLength(2 + 2 + 1 + 1);
  });

  it('stands the default language in for a page with no translation', async () => {
    await put('v2/en/index.mdx');
    await put(
      'v2/en/guides/only-english.mdx',
      '---\ntitle: English only\n---\n',
    );
    await put('v2/fr/index.mdx');
    const site = await discoverSite(dir, both());
    const fr = site.views.find((v) => v.key === 'v2/fr')?.tree.pages ?? [];
    const standIn = fr.find((p) => p.path === '/fr/guides/only-english');
    expect(standIn).toMatchObject({
      fallbackLocale: 'en',
      file: 'v2/en/guides/only-english.mdx',
      locale: 'fr',
      title: 'English only',
    });
    expect(fr.find((p) => p.path === '/fr')?.fallbackLocale).toBeUndefined();
    // navigation written once in docs.json finds the stand-in by its id
    const nav = buildNavigation(
      parseConfig({
        ...both(),
        navigation: [
          {
            tab: 'Docs',
            groups: [{ group: 'G', pages: ['index', 'guides/only-english'] }],
          },
        ],
      }),
      site.views.find((v) => v.key === 'v2/fr')!.tree,
    );
    expect(nav.tabs[0]?.sidebar[0]).toMatchObject({
      type: 'group',
      items: [{ type: 'page' }, { type: 'page' }],
    });
  });

  it('explains where pages go when the default variant is empty', async () => {
    await put('index.mdx');
    await expect(discoverSite(dir, both())).rejects.toThrow(
      /docs\/v2\/en\/index\.mdx/,
    );
  });

  it('refuses a page named like a version or language', async () => {
    await put('v2/en/index.mdx');
    await put('v2/en/fr/hello.mdx');
    await expect(discoverSite(dir, both())).rejects.toThrow(
      /"fr" is the name of a version or language/,
    );
  });

  it('applies urlPrefix before the variant prefix', async () => {
    await put('v2/fr/index.mdx');
    await put('v2/en/index.mdx');
    const config = parseConfig({ ...both(), urlPrefix: '/docs' });
    const site = await discoverSite(dir, config);
    expect(site.views.find((v) => v.key === 'v2/fr')?.tree.pages[0]?.path).toBe(
      '/docs/fr',
    );
    expect(site.tree.pages[0]?.path).toBe('/docs');
  });
});
