import {
  type AskEvent,
  mockLLM,
  parseExcerpts,
  signToken,
  toB64url,
} from '@dockudos/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessProxy } from './access.ts';
import { createDocsApi } from './api.ts';
import { createFeedHandler } from './feeds.ts';
import { createLlmsFullHandler, createLlmsHandler } from './llms.ts';
import { createMarkdownHandler } from './markdown.ts';
import { createMcpHandler } from './mcp.ts';
import { createOgHandler } from './og.ts';
import {
  bookRequest,
  getSite,
  pageMetadata,
  sitemapResponse,
  staticParams,
} from './server.ts';
import { SESSION_COOKIE } from './session.ts';

const SECRET = 's'.repeat(48);
const TOKEN = 'vault-token-1234';

let root: string;
let cwd: string;

const put = async (file: string, text: string) => {
  const full = join(root, 'docs', file);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text);
};
const page = (title: string, body: string, extra = '') =>
  `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

const config = {
  name: 'Acme',
  seo: { siteUrl: 'https://docs.test', description: 'Acme docs' },
  versions: {
    default: 'v2',
    list: [
      { name: 'v2', label: '2.x' },
      { name: 'v1', label: '1.x', status: 'deprecated' },
    ],
  },
  i18n: {
    default: 'en',
    locales: ['en', 'fr', { code: 'ar', label: 'العربية' }],
    messages: { fr: { search: 'Chercher' } },
  },
  auth: { issuer: 'https://idp.test', clientId: 'dockudos' },
  access: {
    rules: [
      { paths: ['/team/**'], require: 'login', roles: ['staff'] },
      { paths: ['/vault/**'], require: 'token' },
    ],
  },
  feeds: { changelog: true, posts: true },
  ai: { enabled: true, provider: 'custom', limits: { ratePerMinute: 100 } },
  navigation: [
    {
      tab: 'Docs',
      groups: [
        {
          group: 'Start',
          pages: ['index', 'guides/auth', 'guides/only-english'],
        },
      ],
    },
  ],
};

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-scale-'));
  await writeFile(join(root, 'docs.json'), JSON.stringify(config));
  await put('v2/en/index.mdx', page('Home', 'Welcome to Acme.'));
  await put(
    'v2/en/guides/auth.mdx',
    page(
      'Authentication',
      '## API keys\n\nRotate a key every ninety days, current version.',
    ),
  );
  await put(
    'v2/en/guides/only-english.mdx',
    page('Only English', 'This guide has no translation.'),
  );
  await put(
    'v2/en/changelog.mdx',
    page(
      'Changelog',
      '<Update label="2.0.0" date="2026-03-31" tags={["Added"]}>\n\nNew `thing` shipped.\n\n</Update>\n\n<Update label="1.9.0" date="2026-01-15" tags={["Fixed"]}>\n\nFixed it.\n\n</Update>',
    ),
  );
  await put(
    'v2/en/blog/launch.mdx',
    page('Launch post', 'We launched.', 'date: 2026-02-01\ntags: [news]\n'),
  );
  await put(
    'v2/en/team/handbook.mdx',
    page('Handbook', 'SECRET-TEAM-HANDBOOK: salaries and plans. Rotate a key.'),
  );
  await put(
    'v2/en/vault/keys.mdx',
    page('Vault', 'SECRET-VAULT-KEYS: the master key. Rotate a key.'),
  );
  await put('v2/fr/index.mdx', page('Accueil', 'Bienvenue chez Acme.'));
  await put(
    'v2/fr/guides/auth.mdx',
    page(
      'Authentification',
      '## Clés API\n\nFaire tourner une clé tous les quatre-vingt-dix jours.',
    ),
  );
  await put(
    'v2/fr/team/handbook.mdx',
    page('Manuel', 'SECRET-FR-TEAM: salaires.'),
  );
  await put('v2/ar/index.mdx', page('الرئيسية', 'مرحبا'));
  await put('v1/en/index.mdx', page('Home v1', 'Legacy home.'));
  await put(
    'v1/en/guides/auth.mdx',
    page(
      'Authentication v1',
      '## API keys\n\nLegacy key rotation, V1ONLY, every thirty days.',
    ),
  );
  await put('v1/fr/index.mdx', page('Accueil v1', 'Ancienne maison.'));
  process.chdir(root);
  vi.stubEnv('DOCKUDOS_AUTH_SECRET', SECRET);
  vi.stubEnv('DOCKUDOS_TOKEN', TOKEN);
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

const url = (path: string) => `http://docs.test${path}`;
const ctx = (...segments: string[]) => ({
  params: Promise.resolve({ dockudos: segments }),
});

/** A signed-in browser: the session cookie for a user with these roles. */
async function cookieFor(roles: string[], sub = 'u1') {
  const token = await signToken({ sub, roles, groups: [] }, SECRET, {
    purpose: 'session',
    ttlSeconds: 3600,
  });
  return `${SESSION_COOKIE}=${token}`;
}

const asks = (body: object, headers: Record<string, string> = {}) =>
  new Request(url('/api/ask'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function events(res: Response): Promise<AskEvent[]> {
  return (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((b) => JSON.parse(b.replace(/^data: /, '')) as AskEvent);
}
const citing = () =>
  mockLLM(
    (input) =>
      `${parseExcerpts(input.messages.at(-1)?.content ?? '')[0]?.text} [1]`,
  );

describe('the site model', () => {
  it('has a view for every version and language, with the defaults first and unprefixed', async () => {
    const site = await getSite({ root });
    expect(site.views.map((v) => v.key)).toEqual([
      'v2/en',
      'v2/fr',
      'v2/ar',
      'v1/en',
      'v1/fr',
      'v1/ar',
    ]);
    expect(site.find(['guides', 'auth'])?.title).toBe('Authentication');
    expect(site.find(['fr', 'guides', 'auth'])?.title).toBe('Authentification');
    expect(site.find(['v1', 'guides', 'auth'])?.title).toBe(
      'Authentication v1',
    );
    expect(site.find(['v2', 'guides', 'auth'])).toBeUndefined();
    expect(site.find([])?.title).toBe('Home');
    expect(site.find(['fr'])?.title).toBe('Accueil');
  });

  it('sends addresses that spell out a default to the short one', async () => {
    const site = await getSite({ root });
    expect(site.redirectFor(['en', 'guides', 'auth'])).toBe('/guides/auth');
    expect(site.redirectFor(['v2', 'guides', 'auth'])).toBe('/guides/auth');
    expect(site.redirectFor(['v2', 'fr', 'guides', 'auth'])).toBe(
      '/fr/guides/auth',
    );
    expect(site.redirectFor(['v2'])).toBe('/');
    expect(site.redirectFor(['en', 'nope'])).toBeUndefined();
    expect(site.redirectFor(['guides', 'auth'])).toBeUndefined();
  });

  it('builds a sidebar per view: the default exact, the others without what they lack', async () => {
    const site = await getSite({ root });
    const titles = (key: string) =>
      site
        .view({ version: key.split('/')[0], locale: key.split('/')[1] })
        .nav.tabs[0]?.sidebar.flatMap((g) =>
          g.type === 'group'
            ? g.items.flatMap((i) => (i.type === 'page' ? [i.page.title] : []))
            : [],
        );
    expect(titles('v2/en')).toEqual(['Home', 'Authentication', 'Only English']);
    expect(titles('v2/fr')).toEqual([
      'Accueil',
      'Authentification',
      'Only English',
    ]);
    expect(titles('v1/en')).toEqual(['Home v1', 'Authentication v1']);
  });

  it('shows an untranslated page in the default language, flagged', async () => {
    const site = await getSite({ root });
    const standIn = site.find(['fr', 'guides', 'only-english']);
    expect(standIn).toMatchObject({
      fallbackLocale: 'en',
      locale: 'fr',
      file: 'v2/en/guides/only-english.mdx',
    });
    expect(site.variantUi(standIn!).fallback).toEqual({
      language: 'Français',
      original: 'English',
    });
  });

  it('gives the switcher the same page where it exists, and a parent where it does not', async () => {
    const site = await getSite({ root });
    const ui = site.variantUi(site.find(['guides', 'auth'])!);
    expect(ui.locales.find((l) => l.code === 'fr')).toMatchObject({
      path: '/fr/guides/auth',
      exact: true,
    });
    expect(ui.locales.find((l) => l.code === 'ar')).toMatchObject({
      path: '/ar',
      exact: false,
    });
    expect(ui.versions.find((v) => v.name === 'v1')).toMatchObject({
      path: '/v1/guides/auth',
      exact: true,
    });
    expect(ui.banner).toBeUndefined();
    const old = site.variantUi(site.find(['v1', 'guides', 'auth'])!);
    expect(old.banner).toMatchObject({
      kind: 'deprecated',
      latest: { path: '/guides/auth', exact: true },
    });
    expect(site.variantUi(site.find(['ar'])!).dir).toBe('rtl');
    expect(site.messages(site.find(['fr'])!).search).toBe('Chercher');
    expect(site.messages(site.find([])!).search).toBe('Search');
  });

  it('applies a rule written for the default to every version and language', async () => {
    const site = await getSite({ root });
    expect(site.isProtected(site.find(['team', 'handbook'])!)).toBe(true);
    expect(site.isProtected(site.find(['fr', 'team', 'handbook'])!)).toBe(true);
    expect(site.isProtected(site.find(['guides', 'auth'])!)).toBe(false);
  });

  it('builds public pages ahead of time and renders protected ones on request', async () => {
    const site = await getSite({ root });
    const built = staticParams(site).map((p) => p.slug.join('/'));
    expect(built).toContain('guides/auth');
    expect(built).toContain('fr/guides/auth');
    expect(built).not.toContain('team/handbook');
    expect(built).not.toContain('fr/team/handbook');
    expect(built).not.toContain('vault/keys');
  });

  it('shows the sidebar without protected pages on open pages, and with them on protected ones', async () => {
    const site = await getSite({ root });
    const titles = (nav: ReturnType<typeof site.navFor>) =>
      nav.tabs
        .flatMap(
          (t) => JSON.stringify(t.sidebar).match(/"title":"[^"]+"/g) ?? [],
        )
        .join(' ');
    // (the fixture lists no private page in its navigation, so add one and look again)
    await writeFile(
      join(root, 'docs.json'),
      JSON.stringify({
        ...config,
        navigation: [
          {
            tab: 'Docs',
            groups: [
              { group: 'Start', pages: ['index', 'guides/auth'] },
              { group: 'Team', pages: ['team/handbook'] },
            ],
          },
        ],
      }),
    );
    const listed = await getSite({ root });
    expect(titles(listed.navFor(listed.find(['guides', 'auth'])!))).not.toMatch(
      /Handbook|Team/,
    );
    expect(
      titles(listed.navFor(listed.find(['fr', 'guides', 'auth'])!)),
    ).not.toMatch(/Manuel|Team/);
    expect(titles(listed.navFor(listed.find(['team', 'handbook'])!))).toMatch(
      /Handbook/,
    );
    expect(listed.view().nav.tabs[0]?.sidebar).toHaveLength(2);
    expect(site.views).toHaveLength(6);
  });

  it('scopes the book (PDF) to one version, language and section', async () => {
    const site = await getSite({ root });
    const paths = async (q: Record<string, string>) => {
      const { scope, under } = await bookRequest(site, q);
      return (await site.book({ scope, under })).map((b) => b.page.path);
    };
    expect(await paths({})).toEqual([
      '/',
      '/guides/auth',
      '/guides/only-english',
      '/changelog',
      '/blog/launch',
    ]);
    expect(await paths({ version: 'v1' })).toEqual(['/v1', '/v1/guides/auth']);
    expect(await paths({ locale: 'fr' })).toEqual(
      expect.arrayContaining(['/fr', '/fr/guides/auth']),
    );
    expect(await paths({ path: '/guides' })).toEqual([
      '/guides/auth',
      '/guides/only-english',
    ]);
    expect((await bookRequest(site, { version: 'nope' })).scope).toEqual({});
    expect(
      (await bookRequest(site, Promise.resolve({ path: ['/guides', '/x'] })))
        .under,
    ).toBe('/guides');
    vi.stubEnv('NEXT_PUBLIC_DOCKUDOS_STATIC', '1');
    expect((await bookRequest(site, { version: 'v1' })).scope).toEqual({
      version: 'v2',
      locale: 'en',
    });
    vi.unstubAllEnvs();
  });
});

describe('metadata, sitemap', () => {
  it('canonicalizes translations and old versions and lists alternates', async () => {
    const site = await getSite({ root });
    const meta = (slug: string[]) => pageMetadata(site, site.find(slug)!);
    expect(meta(['guides', 'auth']).alternates).toMatchObject({
      canonical: 'https://docs.test/guides/auth',
      languages: {
        en: 'https://docs.test/guides/auth',
        'x-default': 'https://docs.test/guides/auth',
        fr: 'https://docs.test/fr/guides/auth',
      },
    });
    // an old version's page points at the latest; a stand-in at the original, and is not indexed
    expect(meta(['v1', 'guides', 'auth']).alternates?.canonical).toBe(
      'https://docs.test/guides/auth',
    );
    const standIn = meta(['fr', 'guides', 'only-english']);
    expect(standIn.alternates?.canonical).toBe(
      'https://docs.test/guides/only-english',
    );
    expect(standIn.robots).toEqual({ index: false, follow: true });
    expect(meta(['team', 'handbook']).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('lists each page once, with alternates, and leaves out stand-ins, old copies and protected pages', async () => {
    const xml = await (await sitemapResponse(await getSite({ root }))).text();
    expect(xml).toContain('<loc>https://docs.test/guides/auth</loc>');
    expect(xml).toContain(
      'hreflang="fr" href="https://docs.test/fr/guides/auth"',
    );
    expect(xml).toContain('hreflang="x-default"');
    expect(xml).not.toContain(
      'only-english</loc>'.replace('only', '/fr/guides/only'),
    );
    expect(xml).not.toContain('<loc>https://docs.test/v1/guides/auth</loc>');
    expect(xml).not.toMatch(/team|vault/);
  });
});

describe('every public surface keeps to one version and language, and keeps secrets back', () => {
  const MARKERS = [
    'SECRET-TEAM-HANDBOOK',
    'SECRET-VAULT-KEYS',
    'SECRET-FR-TEAM',
  ];

  it('search finds only the asked version and language', async () => {
    const api = createDocsApi();
    const search = async (query: string) =>
      (
        await (
          await api.GET(
            new Request(url(`/api/search?q=rotate+key&${query}`)),
            ctx('search'),
          )
        ).json()
      ).hits.map((h: { url: string }) => h.url);
    expect(await search('')).toEqual(['/guides/auth#api-keys']);
    expect(await search('version=v1')).toEqual(['/v1/guides/auth#api-keys']);
    expect(
      (await search('locale=fr')).every((u: string) => u.startsWith('/fr/')),
    ).toBe(true);
    const bad = await api.GET(
      new Request(url('/api/search?q=x&version=v9')),
      ctx('search'),
    );
    expect(bad.status).toBe(400);
  });

  it('serves the browser one version and language of the index, and no protected page', async () => {
    const api = createDocsApi();
    const load = async (
      query: string,
      headers: Record<string, string> = {},
    ) => {
      const res = await api.GET(
        new Request(url(`/api/search/index?${query}`), { headers }),
        ctx('search', 'index'),
      );
      return {
        res,
        index: (await res.json()) as {
          pages: { path: string; locale: string; version: string }[];
        },
      };
    };
    const open = await load('version=v2&locale=en');
    expect(open.res.headers.get('cache-control')).toContain('public');
    expect(
      open.index.pages.every((p) => p.locale === 'en' && p.version === 'v2'),
    ).toBe(true);
    expect(JSON.stringify(open.index)).not.toMatch(
      new RegExp(MARKERS.join('|')),
    );
    expect(open.index.pages.map((p) => p.path)).not.toContain('/team/handbook');
    const fr = await load('version=v2&locale=fr');
    expect(fr.index.pages.every((p) => p.locale === 'fr')).toBe(true);

    // a signed-in staff member gets the team page, privately cached
    const staff = await load('version=v2&locale=en', {
      cookie: await cookieFor(['staff']),
    });
    expect(staff.index.pages.map((p) => p.path)).toContain('/team/handbook');
    expect(staff.index.pages.map((p) => p.path)).not.toContain('/vault/keys');
    expect(staff.res.headers.get('cache-control')).toContain('private');
    // ... and the vault with the token
    const vault = await load('version=v2&locale=en', {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(vault.index.pages.map((p) => p.path)).toContain('/vault/keys');
    // the anonymous index is untouched afterwards
    expect(
      JSON.stringify((await load('version=v2&locale=en')).index),
    ).not.toContain('SECRET');
    // revalidation works on the public form
    const first = await api.GET(
      new Request(url('/api/search/index?version=v2&locale=en')),
      ctx('search', 'index'),
    );
    const again = await api.GET(
      new Request(url('/api/search/index?version=v2&locale=en'), {
        headers: { 'if-none-match': first.headers.get('etag') ?? '' },
      }),
      ctx('search', 'index'),
    );
    expect(again.status).toBe(304);
  });

  it("shows the assistant only the sources the caller may read, in the caller's version and language", async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    const sourcesFor = async (
      body: object,
      headers: Record<string, string> = {},
    ) => {
      const res = await api.POST(
        asks({ question: 'How do I rotate a key?', ...body }, headers),
        ctx('ask'),
      );
      expect(res.status).toBe(200);
      const list = await events(res);
      return list.flatMap((e) =>
        e.type === 'sources' ? e.items.map((i) => i.url.split('#')[0]) : [],
      );
    };
    const anon = await sourcesFor({});
    expect(anon).toEqual(['/guides/auth']);
    const staff = await sourcesFor({}, { cookie: await cookieFor(['staff']) });
    expect(staff).toContain('/team/handbook');
    expect(staff).not.toContain('/vault/keys');
    // (the assistant's own API keys use the Authorization header, so a token for a page goes in X-Docs-Token)
    const vault = await sourcesFor({}, { 'x-docs-token': TOKEN });
    expect(vault).toContain('/vault/keys');
    expect(vault).not.toContain('/team/handbook');
    expect(await sourcesFor({ version: 'v1' })).toEqual(['/v1/guides/auth']);
    // two people with different roles get different answers to the same question: never a cached one for the other
    const anonAgain = await sourcesFor({});
    expect(anonAgain).toEqual(['/guides/auth']);
    // an unknown scope is refused
    const bad = await api.POST(
      asks({ question: 'How do I rotate a key?', locale: 'xx' }),
      ctx('ask'),
    );
    expect(bad.status).toBe(400);
  });

  it("asks the model to answer in the reader's language", async () => {
    const llm = citing();
    const api = createDocsApi({ ai: { llm } });
    await (
      await api.POST(
        asks({ question: 'Faire tourner une clé ?', locale: 'fr' }),
        ctx('ask'),
      )
    ).text();
    expect(llm.calls[0]?.system).toContain('Write the answer in French');
    await (
      await api.POST(
        asks({ question: 'How do I rotate a key every ninety days?' }),
        ctx('ask'),
      )
    ).text();
    expect(llm.calls[1]?.system).toContain('Write the answer in English');
  });

  it('navigates inside the scope and the permissions of the caller', async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    const go = async (body: object, headers: Record<string, string> = {}) => {
      const res = await api.POST(
        new Request(url('/api/navigate'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
        ctx('navigate'),
      );
      return res.status === 200
        ? ((await res.json()) as { path: string }).path
        : res.status;
    };
    expect(await go({ query: 'handbook salaries' })).toBe(404);
    expect(
      await go(
        { query: 'handbook salaries' },
        { cookie: await cookieFor(['staff']) },
      ),
    ).toBe('/team/handbook');
    expect(await go({ query: 'legacy key rotation', version: 'v1' })).toBe(
      '/v1/guides/auth',
    );
    expect(await go({ query: 'legacy key rotation' })).not.toBe(
      '/v1/guides/auth',
    );
  });

  it('serves the MCP tools by version and language, and protected pages only to the right caller', async () => {
    const { POST } = createMcpHandler();
    const call = async (
      name: string,
      args: object,
      headers: Record<string, string> = {},
    ) => {
      const res = await POST(
        new Request(url('/mcp'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        }),
      );
      return (await res.json()).result as {
        content: { text: string }[];
        isError?: boolean;
      };
    };
    const text = (r: { content: { text: string }[] }) =>
      r.content[0]?.text ?? '';
    expect(text(await call('search_docs', { query: 'rotate key' }))).toContain(
      '/guides/auth',
    );
    expect(
      text(await call('search_docs', { query: 'rotate key' })),
    ).not.toMatch(/team|vault|v1/);
    expect(
      text(await call('search_docs', { query: 'rotate key', version: 'v1' })),
    ).toContain('/v1/guides/auth');
    const unknown = await call('search_docs', { query: 'x', version: 'v9' });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/Versions: v2, v1\. Languages: en, fr, ar/);
    // listing covers the defaults, or what is named
    expect(text(await call('list_pages', {}))).not.toContain('/v1');
    expect(text(await call('list_pages', { version: 'v1' }))).toContain(
      '/v1/guides/auth',
    );
    // a protected page: refused without credentials, read with them; search sees it only with them too
    expect((await call('get_page', { path: '/vault/keys' })).isError).toBe(
      true,
    );
    expect(
      text(
        await call(
          'get_page',
          { path: '/vault/keys' },
          { authorization: `Bearer ${TOKEN}` },
        ),
      ),
    ).toContain('SECRET-VAULT-KEYS');
    expect(
      text(await call('search_docs', { query: 'master key' })),
    ).not.toContain('vault');
    expect(
      text(
        await call(
          'search_docs',
          { query: 'master key' },
          { authorization: `Bearer ${TOKEN}` },
        ),
      ),
    ).toContain('/vault/keys');
  });

  it('crawls every public surface unauthenticated and finds no private text', async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    const surfaces: [string, string][] = [];
    const add = async (label: string, res: Response | Promise<Response>) =>
      surfaces.push([label, await (await res).text()]);

    for (const query of ['', 'version=v1', 'locale=fr', 'locale=ar'])
      await add(
        `index ${query}`,
        api.GET(
          new Request(url(`/api/search/index?${query}`)),
          ctx('search', 'index'),
        ),
      );
    await add(
      'search',
      api.GET(
        new Request(url('/api/search?q=SECRET+salaries+master+key+rotate')),
        ctx('search'),
      ),
    );
    await add('llms.txt', createLlmsHandler()(new Request(url('/llms.txt'))));
    await add(
      'llms-full.txt',
      createLlmsFullHandler()(new Request(url('/llms-full.txt?locale=fr'))),
    );
    await add('sitemap', sitemapResponse(await getSite({ root })));
    await add(
      'changelog feed',
      createFeedHandler('changelog')(new Request(url('/changelog.xml'))),
    );
    await add(
      'posts feed',
      createFeedHandler('posts')(new Request(url('/rss.xml'))),
    );
    await add(
      'ask',
      api.POST(
        asks({ question: 'What are the salaries? SECRET master key rotate' }),
        ctx('ask'),
      ),
    );
    await add(
      'navigate',
      api.POST(
        new Request(url('/api/navigate'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'team handbook salaries' }),
        }),
        ctx('navigate'),
      ),
    );
    for (const path of ['/team/handbook', '/fr/team/handbook', '/vault/keys']) {
      await add(
        `page ${path}`,
        api.GET(new Request(url(`/api/page?path=${path}`)), ctx('page')),
      );
      await add(
        `markdown ${path}`,
        createMarkdownHandler()(new Request(url(`/api/markdown?path=${path}`))),
      );
      await add(
        `og ${path}`,
        Promise.resolve(
          new Response(
            String(
              (await createOgHandler()(new Request(url(`/og${path}.png`))))
                .status,
            ),
          ),
        ),
      );
    }
    const site = await getSite({ root });
    surfaces.push([
      'book',
      JSON.stringify((await site.book()).map((b) => b.page.path)),
    ]);
    surfaces.push(['graph', JSON.stringify(await site.graph())]);
    surfaces.push([
      'nav',
      JSON.stringify(
        [...site.views.flatMap((v) => v.nav.tabs)].map((t) => t.sidebar.length),
      ),
    ]);

    expect(surfaces.length).toBeGreaterThan(20);
    for (const [label, body] of surfaces) {
      expect(body, label).not.toMatch(/SECRET-/);
      expect(body, label).not.toContain('salaries and plans');
      expect(body, label).not.toContain('the master key');
    }
    // the surfaces that are about a protected page refuse it rather than answer
    expect(surfaces.find(([l]) => l === 'page /team/handbook')?.[1]).toMatch(
      /Sign in|Not signed/i,
    );
  });
});

describe('logging in', () => {
  it('redirects a person to sign in, and tells a script it is not signed in', async () => {
    const proxy = createAccessProxy({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      rules: (await getSite({ root })).config.access.rules,
    });
    const page = await proxy(
      new Request(url('/team/handbook?x=1'), {
        headers: { accept: 'text/html' },
      }),
    );
    expect(page?.status).toBe(302);
    expect(page?.headers.get('location')).toBe(
      'http://docs.test/api/auth/login?returnTo=%2Fteam%2Fhandbook%3Fx%3D1',
    );
    const translated = await proxy(
      new Request(url('/fr/team/handbook'), {
        headers: { accept: 'text/html' },
      }),
    );
    expect(translated?.status).toBe(302);
    const script = await proxy(
      new Request(url('/team/handbook'), {
        headers: { accept: 'application/json' },
      }),
    );
    expect(script?.status).toBe(401);
    // the sign-in routes themselves are open
    expect(await proxy(new Request(url('/api/auth/login')))).toBeUndefined();
  });

  it('lets a user with the role in, and refuses one without (deny by default)', async () => {
    const rules = (await getSite({ root })).config.access.rules;
    const env = { DOCKUDOS_AUTH_SECRET: SECRET };
    const proxy = createAccessProxy({ rules, env });
    const ask = async (roles: string[]) =>
      proxy(
        new Request(url('/team/handbook'), {
          headers: { accept: 'text/html', cookie: await cookieFor(roles) },
        }),
      );
    const staff = await ask(['staff']);
    expect(staff?.status).toBe(200);
    expect(staff?.headers.get('cache-control')).toBe('private, no-store');
    expect((await ask(['guest']))?.status).toBe(403);
    expect((await ask([]))?.status).toBe(403);
    // a forged or expired cookie is no session
    const forged = await proxy(
      new Request(url('/team/handbook'), {
        headers: {
          accept: 'text/html',
          cookie: `${SESSION_COOKIE}=${toB64url(new TextEncoder().encode('{"sub":"x","roles":["staff"]}'))}.AAAA`,
        },
      }),
    );
    expect(forged?.status).toBe(302);
    const expired = await signToken(
      { sub: 'u', roles: ['staff'], groups: [] },
      SECRET,
      { purpose: 'session', ttlSeconds: 1, now: 1000 },
    );
    expect(
      (
        await proxy(
          new Request(url('/team/handbook'), {
            headers: {
              accept: 'text/html',
              cookie: `${SESSION_COOKIE}=${expired}`,
            },
          }),
        )
      )?.status,
    ).toBe(302);
    // without the secret configured, nothing gets in
    const noSecret = createAccessProxy({ rules, env: {} });
    expect(
      (
        await noSecret(
          new Request(url('/team/handbook'), {
            headers: {
              accept: 'text/html',
              cookie: await cookieFor(['staff']),
            },
          }),
        )
      )?.status,
    ).toBe(503);
  });
});

describe('feeds', () => {
  it('writes a changelog feed with an entry per update, newest first, linking to the entry', async () => {
    const res = await createFeedHandler('changelog')(
      new Request(url('/changelog.xml')),
    );
    expect(res.headers.get('content-type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml).toContain('<title>Acme changelog</title>');
    expect(xml).toContain('<link>https://docs.test/changelog#2-0-0</link>');
    expect(xml).toContain('<category>Added</category>');
    expect(xml).toContain('New `thing` shipped.');
    expect(xml.indexOf('2.0.0')).toBeLessThan(xml.indexOf('1.9.0'));
    expect(xml).toContain('<atom:link href="https://docs.test/changelog.xml"');
  });

  it('writes a feed of dated pages, and refuses when off, without a site URL, or for unknown scopes', async () => {
    const xml = await (
      await createFeedHandler('posts')(new Request(url('/rss.xml')))
    ).text();
    expect(xml).toContain('<title>Launch post</title>');
    expect(xml).toContain('<pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate>');
    expect(xml).not.toContain('Handbook');
    expect(
      (await createFeedHandler('posts')(new Request(url('/rss.xml?locale=fr'))))
        .status,
    ).toBe(404); // nothing dated in French
    expect(
      (await createFeedHandler('posts')(new Request(url('/rss.xml?locale=xx'))))
        .status,
    ).toBe(400);
    await writeFile(
      join(root, 'docs.json'),
      JSON.stringify({ ...config, feeds: { changelog: false } }),
    );
    expect(
      (await createFeedHandler('changelog')(new Request(url('/changelog.xml'))))
        .status,
    ).toBe(404);
    await writeFile(
      join(root, 'docs.json'),
      JSON.stringify({ ...config, seo: {} }),
    );
    const noUrl = await createFeedHandler('changelog')(
      new Request(url('/changelog.xml')),
    );
    expect(noUrl.status).toBe(404);
    expect(await noUrl.text()).toContain('seo.siteUrl');
  });

  it('leaves a protected changelog out', async () => {
    await writeFile(
      join(root, 'docs.json'),
      JSON.stringify({
        ...config,
        access: { rules: [{ paths: ['/changelog'], require: 'deny' }] },
      }),
    );
    expect(
      (await createFeedHandler('changelog')(new Request(url('/changelog.xml'))))
        .status,
    ).toBe(404);
  });
});

describe('social cards', () => {
  it('draws a PNG for a page, and a bare card for a protected one', async () => {
    const handler = createOgHandler();
    const res = await handler(new Request(url('/og/guides/auth.png')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const png = new Uint8Array(await res.arrayBuffer());
    expect([...png.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect((await handler(new Request(url('/og/index.png')))).status).toBe(200);
    expect(
      (await handler(new Request(url('/og/v1/guides/auth.png')))).status,
    ).toBe(200);
    expect(
      (await handler(new Request(url('/og/team/handbook.png')))).status,
    ).toBe(200);
    expect((await handler(new Request(url('/og/nope.png')))).status).toBe(404);
  });
});

describe('language detection in the proxy', () => {
  const i18n = {
    default: 'en',
    locales: ['en', 'fr', 'ar'],
    versions: ['v2', 'v1'],
    detect: true,
  };
  const proxy = createAccessProxy({ rules: [], i18n });
  const get = (path: string, headers: Record<string, string> = {}) =>
    proxy(
      new Request(url(path), { headers: { accept: 'text/html', ...headers } }),
    );

  it('sends a first visit to the browser language, keeping the version', async () => {
    const res = await get('/guides/auth?x=1', {
      'accept-language': 'fr-CA,fr;q=0.9,en;q=0.5',
    });
    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toBe(
      'http://docs.test/fr/guides/auth?x=1',
    );
    expect(res?.headers.get('vary')).toContain('Accept-Language');
    expect(
      (await get('/v1/guides/auth', { 'accept-language': 'fr' }))?.headers.get(
        'location',
      ),
    ).toBe('http://docs.test/v1/fr/guides/auth');
  });

  it('leaves alone: the default language, a language already in the address, files, the API, other methods, and a remembered choice', async () => {
    expect(
      await get('/guides/auth', { 'accept-language': 'en-US' }),
    ).toBeUndefined();
    expect(await get('/guides/auth')).toBeUndefined();
    expect(
      await get('/fr/guides/auth', { 'accept-language': 'ar' }),
    ).toBeUndefined();
    expect(await get('/logo.png', { 'accept-language': 'fr' })).toBeUndefined();
    expect(
      await get('/api/search', { 'accept-language': 'fr' }),
    ).toBeUndefined();
    expect(await get('/_next/x', { 'accept-language': 'fr' })).toBeUndefined();
    expect(
      await proxy(
        new Request(url('/guides/auth'), {
          method: 'POST',
          headers: { accept: 'text/html', 'accept-language': 'fr' },
        }),
      ),
    ).toBeUndefined();
    expect(
      await proxy(
        new Request(url('/guides/auth'), {
          headers: { accept: 'application/json', 'accept-language': 'fr' },
        }),
      ),
    ).toBeUndefined();
    expect(
      await get('/guides/auth', {
        'accept-language': 'fr',
        cookie: 'dockudos-locale=en',
      }),
    ).toBeUndefined();
    expect(
      (
        await get('/guides/auth', {
          'accept-language': 'en',
          cookie: 'dockudos-locale=ar',
        })
      )?.headers.get('location'),
    ).toBe('http://docs.test/ar/guides/auth');
    expect(
      (
        await get('/guides/auth', {
          'accept-language': 'ar',
          cookie: 'dockudos-locale=zz',
        })
      )?.headers.get('location'),
    ).toBe('http://docs.test/ar/guides/auth');
  });

  it('does nothing when detection is off or the prefix does not match', async () => {
    const off = createAccessProxy({
      rules: [],
      i18n: { ...i18n, detect: false },
    });
    expect(
      await off(
        new Request(url('/x'), {
          headers: { accept: 'text/html', 'accept-language': 'fr' },
        }),
      ),
    ).toBeUndefined();
    const docs = createAccessProxy({
      rules: [],
      i18n: { ...i18n, urlPrefix: '/docs' },
    });
    const headers = { accept: 'text/html', 'accept-language': 'fr' };
    expect(
      (
        await docs(new Request(url('/docs/guides/a'), { headers }))
      )?.headers.get('location'),
    ).toBe('http://docs.test/docs/fr/guides/a');
    expect(
      await docs(new Request(url('/blog/a'), { headers })),
    ).toBeUndefined();
  });

  it('also redirects pages that are protected, once the visitor is allowed in', async () => {
    const both = createAccessProxy({
      rules: [{ paths: ['/team/**'], require: 'deny' }],
      i18n,
    });
    expect(
      (
        await both(
          new Request(url('/team/x'), {
            headers: { accept: 'text/html', 'accept-language': 'fr' },
          }),
        )
      )?.status,
    ).toBe(404);
    const withToken = createAccessProxy({
      rules: [{ paths: ['/team/**'], require: 'token' }],
      i18n,
      env: { DOCKUDOS_TOKEN: TOKEN },
    });
    const res = await withToken(
      new Request(url('/team/x'), {
        headers: {
          accept: 'text/html',
          'accept-language': 'fr',
          authorization: `Bearer ${TOKEN}`,
        },
      }),
    );
    expect(res?.status).toBe(307);
    expect(res?.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
