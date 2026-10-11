import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSite } from '../node.ts';
import { systemPrompt } from './ask.ts';
import { parseConfig } from './config.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { headingSlugger } from './helpers.ts';
import { createSiteBackend } from './mcp-site.ts';
import { McpScopeError, createMcpServer } from './mcp.ts';
import {
  type Navigation,
  buildNavigation,
  pruneNavigation,
} from './navigation.ts';
import { buildPageTree } from './page-tree.ts';
import { fetchJwks, verifyIdToken } from './oidc.ts';
import { claimList, safeReturnTo } from './principal.ts';
import {
  createEndpointBackend,
  fetchIndex,
  searchIndexUrl,
} from './search-backend.ts';
import { buildSitemap, canonicalPath, pageAlternates, pageSeo } from './seo.ts';
import { fromB64url, verifyToken } from './session.ts';
import {
  type FindPage,
  type Variant,
  variantKey,
  variantPrefix,
} from './variants.ts';

describe('SEO with versions and languages', () => {
  const config = parseConfig({
    name: 'Acme',
    seo: { siteUrl: 'https://docs.acme.com/' },
    versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
    i18n: { default: 'en', locales: ['en', 'fr'] },
  });
  const tree = buildPageTree(
    [
      { file: 'v2/en/a.mdx', title: 'A' },
      { file: 'v2/fr/a.mdx', title: 'A fr' },
      { file: 'v2/en/only.mdx', title: 'Only' },
      { file: 'v1/en/a.mdx', title: 'A v1' },
      { file: 'v1/en/old.mdx', title: 'Old' },
    ],
    { dir: 'v2/en', prefix: '', segments: [], locale: 'en', version: 'v2' },
  );
  // Build the real variant trees: easier than hand-making pages.
  const views: Record<string, ReturnType<typeof buildPageTree>> = {};
  const make = (
    version: string,
    locale: string,
    files: {
      file: string;
      title: string;
      fallbackLocale?: string;
      contentFile?: string;
    }[],
  ) => {
    const variant: Variant = { version, locale };
    const prefix = variantPrefix(config, variant);
    views[variantKey(variant)] = buildPageTree(files, {
      dir: `${version}/${locale}`,
      prefix,
      segments: prefix.split('/').filter(Boolean),
      locale,
      version,
    });
  };
  make('v2', 'en', [
    { file: 'v2/en/a.mdx', title: 'A' },
    { file: 'v2/en/only.mdx', title: 'Only' },
  ]);
  make('v2', 'fr', [
    { file: 'v2/fr/a.mdx', title: 'A fr' },
    {
      file: 'v2/en/only.mdx',
      title: 'Only',
      fallbackLocale: 'en',
      contentFile: 'only.mdx',
    },
  ]);
  make('v1', 'en', [
    { file: 'v1/en/a.mdx', title: 'A v1' },
    { file: 'v1/en/old.mdx', title: 'Old' },
  ]);
  const all = Object.values(views).flatMap((v) => v.pages);
  const find: FindPage = (v, rel) => {
    const p = all.find(
      (x) =>
        x.rel === rel &&
        variantKey({ version: x.version, locale: x.locale }) === variantKey(v),
    );
    return (
      p && {
        path: p.path,
        rel: p.rel,
        ...(p.fallbackLocale && { fallbackLocale: p.fallbackLocale }),
      }
    );
  };
  const at = (path: string) => all.find((p) => p.path === path)!;
  void tree;

  it('names the canonical page: itself, the original of a stand-in, the latest of an old version', () => {
    expect(canonicalPath(config, find, at('/a'))).toBe('/a');
    expect(canonicalPath(config, find, at('/fr/only'))).toBe('/only');
    expect(canonicalPath(config, find, at('/v1/a'))).toBe('/a');
    expect(canonicalPath(config, find, at('/v1/old'))).toBe('/v1/old'); // nothing newer to point at
    // a stand-in whose original is missing stays itself
    expect(canonicalPath(config, () => undefined, at('/fr/only'))).toBe(
      '/fr/only',
    );
  });

  it('lists alternates only for real translations', () => {
    expect(
      pageAlternates(config, find, at('/a')).map((a) => a.hreflang),
    ).toEqual(['en', 'x-default', 'fr']);
    expect(pageAlternates(config, find, at('/fr/only'))).toEqual([]);
  });

  it('puts canonical and absolute alternates in the page SEO, and nothing without a site URL', () => {
    const seo = pageSeo(config, at('/a'), {
      canonicalPath: '/a',
      alternates: pageAlternates(config, find, at('/a')),
    });
    expect(seo.canonical).toBe('https://docs.acme.com/a');
    expect(seo.alternates).toEqual([
      { hreflang: 'en', path: 'https://docs.acme.com/a' },
      { hreflang: 'x-default', path: 'https://docs.acme.com/a' },
      { hreflang: 'fr', path: 'https://docs.acme.com/fr/a' },
    ]);
    const plain = pageSeo(
      { ...config, seo: { noindex: false, ogImages: true } },
      at('/a'),
      { alternates: [{ hreflang: 'fr', path: '/fr/a' }] },
    );
    expect(plain.canonical).toBeUndefined();
    expect(plain.alternates).toBeUndefined();
    expect(pageSeo(config, at('/a')).alternates).toBeUndefined();
  });

  it('lists a page once, with its translations, and leaves out stand-ins and old copies', () => {
    const xml = buildSitemap(config, all, () => undefined, {
      config,
      find,
    }) as string;
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(
      '<loc>https://docs.acme.com/a</loc><xhtml:link rel="alternate" hreflang="en" href="https://docs.acme.com/a"/>',
    );
    expect(xml).toContain('<loc>https://docs.acme.com/fr/a</loc>');
    expect(xml).toContain('<loc>https://docs.acme.com/v1/old</loc>');
    expect(xml).not.toContain('<loc>https://docs.acme.com/fr/only</loc>');
    expect(xml).not.toContain('<loc>https://docs.acme.com/v1/a</loc>');
    // without the variants argument, every page that is not hidden is listed
    expect(buildSitemap(config, all) as string).toContain(
      '<loc>https://docs.acme.com/v1/a</loc>',
    );
  });
});

describe('search backends with a scope', () => {
  it('builds the index address: a query on a server, a file name on a static site', () => {
    expect(searchIndexUrl('/api/search')).toBe('/api/search/index');
    expect(searchIndexUrl('/api/search', {})).toBe('/api/search/index');
    expect(searchIndexUrl('/api/search', { version: 'v1', locale: 'fr' })).toBe(
      '/api/search/index?version=v1&locale=fr',
    );
    expect(searchIndexUrl('/api/search', { locale: 'fr' })).toBe(
      '/api/search/index?locale=fr',
    );
    expect(searchIndexUrl('/api/search', { version: 'v1' })).toBe(
      '/api/search/index?version=v1',
    );
    expect(
      searchIndexUrl('/api/search', { version: 'v1', locale: 'fr' }, true),
    ).toBe('/api/search/index-v1~fr');
    expect(searchIndexUrl('/demo/api/search', { locale: 'ar' }, true)).toBe(
      '/demo/api/search/index-ar',
    );
    expect(searchIndexUrl('/api/search', {}, true)).toBe('/api/search/index');
  });

  it('sends the scope with each search, and loads an index', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => (
      urls.push(url),
      { ok: true, status: 200, json: async () => ({ hits: [] }) }
    );
    await createEndpointBackend('/api/search', {
      fetcher,
      scope: { version: 'v1', locale: 'fr' },
    }).search('x', { limit: 3, maxPerPage: 2 });
    expect(urls[0]).toBe(
      '/api/search?q=x&limit=3&maxPerPage=2&version=v1&locale=fr',
    );
    await expect(
      fetchIndex('/i', async () => ({
        ok: true,
        status: 200,
        json: async () => ({ pages: [] }),
      }))(),
    ).resolves.toEqual({ pages: [] });
    await expect(
      fetchIndex('/i', async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      }))(),
    ).rejects.toThrow(/500/);
    await expect(
      createEndpointBackend('/s', {
        fetcher: async () => ({
          ok: false,
          status: 502,
          json: async () => ({}),
        }),
      }).search('x'),
    ).rejects.toThrow(/502/);
    await expect(
      createEndpointBackend('/s', {
        fetcher: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
        }),
      }).search('x'),
    ).rejects.toThrow(/hits/);
  });
});

describe('navigation without the protected pages', () => {
  const tree = buildPageTree([
    { file: 'index.mdx' },
    { file: 'public.mdx' },
    { file: 'team/a.mdx' },
    { file: 'team/b.mdx' },
    { file: 'stray.mdx' },
  ]);
  const config = parseConfig({
    name: 'X',
    navigation: [
      {
        tab: 'Docs',
        groups: [
          {
            group: 'Open',
            pages: ['index', 'public', { title: 'Site', href: 'https://x.io' }],
          },
          { group: 'Team', pages: ['team/a', 'team/b'] },
          { group: 'Mixed', pages: ['team/a', 'public'] },
        ],
      },
      { tab: 'Elsewhere', href: 'https://x.io' },
    ],
  });
  const nav: Navigation = buildNavigation(config, tree);

  it('drops protected pages, the groups that become empty, and keeps links and tabs', () => {
    const hide = (p: { path: string }) => p.path.startsWith('/team');
    const pruned = pruneNavigation(nav, hide);
    const groups = pruned.tabs[0]?.sidebar.map((g) =>
      g.type === 'group' ? [g.title, g.items.length] : [g.type],
    );
    expect(groups).toEqual([
      ['Open', 3],
      ['Mixed', 1],
    ]);
    expect(pruned.tabs).toHaveLength(2);
    expect(pruned.unlisted.map((p) => p.path)).toEqual(['/stray']);
    expect(pruneNavigation(nav, () => true).unlisted).toEqual([]);
    // the original is untouched
    expect(nav.tabs[0]?.sidebar).toHaveLength(3);
  });

  it('skips what is missing and drops empty groups when lenient, and fails otherwise', () => {
    const missing = parseConfig({
      name: 'X',
      navigation: [
        {
          tab: 'D',
          groups: [
            { group: 'Gone', pages: ['nope'] },
            { group: 'Some', pages: ['public', 'nope'] },
            { group: 'Api', pages: [{ openapi: 'petstore' }] },
          ],
        },
      ],
    });
    expect(() => buildNavigation(missing, tree)).toThrow(/not found/);
    const lenient = buildNavigation(missing, tree, { lenient: true });
    expect(
      lenient.tabs[0]?.sidebar.map((g) => (g.type === 'group' ? g.title : '')),
    ).toEqual(['Some']);
  });
});

describe('small pieces', () => {
  it('numbers repeated headings like the rendered page', () => {
    const slug = headingSlugger();
    expect([slug('Intro'), slug('Intro'), slug('Other thing!')]).toEqual([
      'intro',
      'intro-1',
      'other-thing',
    ]);
  });

  it('reads a date in the frontmatter, and says when it is not one', () => {
    expect(
      parseFrontmatter('---\ntitle: T\ndate: 2026-03-31\ntags: [a]\n---\nbody')
        .data,
    ).toMatchObject({ date: '2026-03-31', tags: ['a'] });
    expect(() =>
      parseFrontmatter('---\ndate: yesterday\n---\n', 'a.mdx'),
    ).toThrow(/must be a date/);
  });

  it('asks for the answer in the reader language only when it can name it', () => {
    expect(systemPrompt('Acme', 'fr')).toContain(
      '7. Write the answer in French',
    );
    expect(systemPrompt('Acme', 'pt-BR')).toContain('Brazilian Portuguese');
    expect(systemPrompt('Acme')).not.toContain('Write the answer in');
    expect(systemPrompt('Acme', 'not a tag')).not.toContain(
      'Write the answer in',
    );
    expect(systemPrompt('Acme', 'en')).toContain('English');
  });

  it('reads claims, return paths and tokens defensively', () => {
    expect(claimList({ a: { b: 'x' } }, 'a.b.c')).toEqual([]);
    expect(claimList({ a: 'x' }, 'a.b')).toEqual([]);
    expect(safeReturnTo('/a?b=1#c')).toBe('/a?b=1');
    expect(fromB64url('a b')).toBeUndefined();
    expect(fromB64url('a')).toBeUndefined();
    expect(fromB64url('YQ')).toEqual(new Uint8Array([97]));
  });

  it('refuses a signed value whose body is not JSON, and one signed with a missing expiry', async () => {
    const { signToken } = await import('./session.ts');
    const secret = 'z'.repeat(40);
    const good = await signToken({ a: 1 }, secret, {
      purpose: 'p',
      ttlSeconds: 60,
      now: 100,
    });
    expect(await verifyToken(good, secret, { purpose: 'p', now: 100 })).toEqual(
      { a: 1 },
    );
    // a validly signed non-JSON body
    const body = btoa('not json').replace(/=+$/, '');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    );
    const text = btoa(String.fromCharCode(...sig))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(
      await verifyToken(`${body}.${text}`, secret, { purpose: 'p' }),
    ).toBeUndefined();
  });

  it('reads signing keys, and an empty set', async () => {
    const ok = (value: unknown) =>
      (async () =>
        new Response(JSON.stringify(value))) as unknown as typeof fetch;
    expect(
      await fetchJwks('https://i/keys', ok({ keys: [{ kty: 'RSA' }] })),
    ).toHaveLength(1);
    expect(await fetchJwks('https://i/keys', ok({}))).toEqual([]);
    await expect(
      fetchJwks(
        'https://i/keys',
        (async () =>
          new Response('', { status: 500 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/500/);
    await expect(
      verifyIdToken('e30.e30.AA', {
        keys: [],
        issuer: 'i',
        clientId: 'c',
        nonce: 'n',
      }),
    ).rejects.toThrow(/unsupported algorithm/);
    await expect(
      verifyIdToken('bm90anNvbg.e30.AA', {
        keys: [],
        issuer: 'i',
        clientId: 'c',
        nonce: 'n',
      }),
    ).rejects.toThrow(/malformed/);
  });
});

describe('the MCP backend over a site with versions, languages and protected pages', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dockudos-mcp-variants-'));
    const put = async (file: string, text: string) => {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), text);
    };
    await put('docs/v2/en/index.mdx', '---\ntitle: Home\n---\nWelcome.');
    await put(
      'docs/v2/en/guide.mdx',
      '---\ntitle: Guide\ndescription: A guide\n---\nInstall the zebra package.',
    );
    await put(
      'docs/v2/en/team/secret.mdx',
      '---\ntitle: Secret\n---\nThe zebra vault code is SECRET-CODE.',
    );
    await put(
      'docs/v2/fr/guide.mdx',
      '---\ntitle: Guide fr\n---\nInstallez le paquet zebra.',
    );
    await put(
      'docs/v1/en/guide.mdx',
      '---\ntitle: Guide v1\n---\nInstall the old zebra package.',
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const config = () =>
    parseConfig({
      name: 'X',
      versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
      i18n: { default: 'en', locales: ['en', 'fr'] },
      access: { rules: [{ paths: ['/team/**'], require: 'deny' }] },
    });

  it('searches and lists one version and language at a time, and never the protected pages', async () => {
    const c = config();
    const { tree, views } = await discoverSite(join(root, 'docs'), c);
    const backend = await createSiteBackend({ root, config: c, tree, views });
    const paths = async (options: object) =>
      (await backend.search('zebra', { limit: 10, ...options })).map(
        (h) => h.path,
      );
    expect(await paths({})).toEqual(['/guide']);
    expect(await paths({ version: 'v1' })).toEqual(['/v1/guide']);
    expect(await paths({ locale: 'fr' })).toEqual(['/fr/guide']);
    expect(
      JSON.stringify(await backend.search('SECRET-CODE vault', { limit: 10 })),
    ).not.toContain('SECRET');
    await expect(
      Promise.resolve().then(() =>
        backend.search('x', { limit: 1, version: 'v9' }),
      ),
    ).rejects.toBeInstanceOf(McpScopeError);

    const listed = async (options?: object) =>
      (await backend.listPages(options)).map((p) => p.path);
    expect(await listed()).toEqual(['/', '/guide']);
    expect(await listed({ version: 'v1' })).toEqual(['/v1/guide']);
    expect(await backend.getPage('/team/secret')).toBe('forbidden');
    expect((await backend.getPage('/guide'))?.valueOf()).toMatchObject({
      title: 'Guide',
    });
  });

  it('turns an unknown version into an answer for the tool, not a crash', async () => {
    const c = config();
    const { tree, views } = await discoverSite(join(root, 'docs'), c);
    const server = createMcpServer(
      { name: 's', version: '1' },
      await createSiteBackend({ root, config: c, tree, views }),
    );
    const reply = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: { query: 'zebra', version: 'v9' },
      },
    });
    expect(JSON.stringify(reply)).toContain('Unknown version');
    expect((reply as { result: { isError: boolean } }).result.isError).toBe(
      true,
    );
  });

  it('works for a site with neither, as before', async () => {
    await rm(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(
      join(root, 'docs/index.mdx'),
      '---\ntitle: Home\n---\nPlain zebra.',
    );
    const c = parseConfig({ name: 'X' });
    const { tree } = await discoverSite(join(root, 'docs'), c);
    const backend = await createSiteBackend({ root, config: c, tree });
    expect(
      (await backend.search('zebra', { limit: 3 })).map((h) => h.path),
    ).toEqual(['/']);
  });
});
