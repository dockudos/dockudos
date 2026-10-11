import {
  type ContentIndex,
  type DocsConfig,
  type FindPage,
  type Messages,
  type Navigation,
  type Page,
  type PageTree,
  type Variant,
  type VariantUi,
  buildNavigation,
  buildRobots,
  buildSitemap,
  buildVariantUi,
  canonicalPath,
  expandAccessRules,
  expandIncludes,
  filterIndex,
  OG_SIZE,
  messagesFor,
  ogImagePath,
  pageAlternates,
  pageMount,
  pruneNavigation,
  parseVariantPath,
  publicIndex,
  resolveScope,
  resolveVisibility,
  findAccessRule,
  flattenSidebar,
  extractLinks,
  resolveDocLink,
  extractToc,
  pageSeo,
  themeCss,
  variantKey,
  variantPrefix,
  versionInfos,
  type SvgIcon,
  type MarkdownComponents,
  type TocEntry,
} from '@dockudos/core';
import {
  buildSiteIndex,
  discoverSite,
  lastModified,
  loadConfig,
  loadIconPacks,
  readIndexFile,
  readPageBody,
  readPageMarkdown,
} from '@dockudos/core/node';
import type { Viewer } from './viewer.ts';
import type { Metadata } from 'next';
import { defineMdxComponents } from './mdx-components.ts';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface SiteOptions {
  /** Project root, where `docs.json` lives. Default `process.cwd()`. */
  root?: string;
  /** Folder with the MDX files, relative to `root`. Default `docs`. */
  docsDir?: string;
}

/** One version and language of the site: its pages and its sidebar. */
export interface SiteView {
  variant: Variant;
  /** `v1/fr`; empty on a site without versions and languages. */
  key: string;
  /** What the addresses start with after `urlPrefix`: `/v1/fr`, empty for the default. */
  prefix: string;
  tree: PageTree;
  nav: Navigation;
  /** `nav` without the pages behind an `access` rule. */
  publicNav: Navigation;
  /** The navigation as built, with the protected pages that no entry lists too: the order of a book. */
  full: Navigation;
}

/** Everything the routes need to know about the site, read from `docs.json` and the docs folder. */
export interface Site {
  /** Absolute project root. */
  root: string;
  /**
   * The configuration. On a site with versions or languages, `access.rules` already cover every one of them
   * (a rule for `/team/**` also covers `/fr/team/**`).
   */
  config: DocsConfig;
  /** The pages of every version and language; its folders and index are the default view's. */
  tree: PageTree;
  /** The sidebar of the default version and language. */
  nav: Navigation;
  /** Every version and language, the default first. A site with neither has one view. */
  views: SiteView[];
  /** The view for a variant; the default view for none. */
  view(variant?: Variant): SiteView;
  /** The view a page belongs to. */
  viewOf(page: Pick<Page, 'locale' | 'version'>): SiteView;
  /**
   * The sidebar to show on a page. A protected page gets the whole sidebar (it is only rendered for someone who was
   * let in); every other page gets one without the protected pages, so it does not tell visitors what is behind a
   * rule.
   */
  navFor(page: Page): Navigation;
  /** Find a page by its URL segments (below `urlPrefix`); no segments is the home page. */
  find(slug?: readonly string[]): Page | undefined;
  /**
   * Where an address that spells out a default (`/en/guides/a`, `/v2/guides/a` for the latest version) should
   * send the reader: the short address of the same page. `undefined` when there is nothing to fix.
   */
  redirectFor(slug: readonly string[]): string | undefined;
  /** Switchers, notices and text direction for a page. */
  variantUi(page: Page): VariantUi;
  /** The interface's words in the page's language. */
  messages(page?: Pick<Page, 'locale'>): Messages;
  /** Look a page up by its variant and its address inside it. */
  finder: FindPage;
  /** Where the home page of a variant is. */
  homeOf(variant: Variant): string;
  /** When the page's source file last changed (Git, else file system). */
  lastModified(page: Page): Promise<Date>;
  /** The page's MDX as people read it: `<include>`s expanded, frontmatter removed. */
  source(page: Page): Promise<string>;
  /** Headings of the page (h2 to h4), with `<include>`s expanded, matching the ids in the rendered page. */
  toc(page: Page): Promise<TocEntry[]>;
  /** Visible pages and the links between them, for `<GraphView />`; of the page's version and language. */
  graph(page?: Pick<Page, 'locale' | 'version'>): Promise<PageGraph>;
  /**
   * Every page in reading order, for one long document (print or PDF): the pages of each tab in
   * navigation order, then visible pages the navigation does not list.
   */
  book(options?: {
    /** One version and language. Default: the site's defaults. */
    scope?: Variant;
    /** Only this page and the pages below it, like `/guides` (an address inside the version and language). */
    under?: string;
  }): Promise<{ page: Page; toc: TocEntry[] }[]>;
  /**
   * The page as plain Markdown: title and description, then the content with `<include>`s expanded and
   * frontmatter removed. For "copy page", `llms.txt`-style exports and AI assistants.
   */
  /** A page as Markdown. `components` are the site's own, added to the built-in ones. */
  markdown(page: Page, components?: MarkdownComponents): Promise<string>;
  /**
   * The content index of the public pages (not hidden, not behind an access rule), for anyone: the file the
   * browser downloads, the static export. In production it is the file `dockudos build` wrote, else it is built
   * from the files, reusing what did not change since the last call.
   */
  index(): Promise<ContentIndex>;
  /**
   * The index as one reader may see it: the public pages plus the protected pages the reader is allowed into.
   * Search, the assistant and the MCP server read this, never the whole index.
   */
  indexFor(viewer: Pick<Viewer, 'canSee' | 'scope'>): Promise<ContentIndex>;
  /** Is a page covered by an `access` rule? Protected pages stay out of the sitemap, graph and the public book. */
  isProtected(page: Page): boolean;
  /** Your icons, read from the SVG packs in docs.json and cleaned. Pass to `DocsRoot` as `icons`. */
  icons: Record<string, SvgIcon>;
}

export interface PageGraph {
  nodes: { id: string; title: string; path: string }[];
  edges: { from: string; to: string }[];
}

const cache = new Map<string, Promise<Site>>();
/** The last index built for each project, so a rebuild in development only re-reads changed pages. */
const lastIndex = new Map<string, ContentIndex>();

/**
 * Load the site. In production the result is cached for the process; in
 * development it is re-read on every call so edits to `docs.json` and new
 * pages show up without a restart.
 */
export function getSite(options: SiteOptions = {}): Promise<Site> {
  const root = resolve(options.root ?? process.cwd());
  const key = `${root}\0${options.docsDir ?? 'docs'}`;
  if (process.env.NODE_ENV === 'production') {
    let site = cache.get(key);
    if (!site)
      cache.set(key, (site = loadSite(root, options.docsDir ?? 'docs')));
    return site;
  }
  return loadSite(root, options.docsDir ?? 'docs');
}

async function loadSite(root: string, docsDir: string): Promise<Site> {
  const dir = join(root, docsDir);
  const loaded = await loadConfig(root);
  const content = await discoverSite(dir, loaded);
  // Rules written for the default version and language cover all of them.
  const config: DocsConfig = {
    ...loaded,
    access: {
      ...loaded.access,
      rules: expandAccessRules(loaded.access.rules, loaded),
    },
  };
  const tree = content.tree;
  const rules = config.access.rules;
  const isProtected = (path: string) => !!findAccessRule(rules, path);
  const urlPrefix = config.urlPrefix ?? '';

  // Every view has its own sidebar; the default one must match docs.json exactly, the others skip what they lack.
  const versions = versionInfos(config);
  const views: SiteView[] = content.views.map((c, n) => {
    const own = versions.find((v) => v.name === c.variant.version)?.navigation;
    const built = buildNavigation(
      { navigation: own ?? config.navigation },
      c.tree,
      { lenient: n > 0 },
    );
    // Pages the author did not list are not advertised (search, "More" lists) when they sit behind a rule.
    // Pages the author listed stay in the navigation: that is their choice.
    return {
      variant: c.variant,
      key: c.key,
      prefix: c.prefix,
      tree: c.tree,
      nav: {
        ...built,
        unlisted: built.unlisted.filter((p) => !isProtected(p.path)),
      },
      publicNav: pruneNavigation(built, (p) => isProtected(p.path)),
      full: built,
    };
  });
  const main = views[0] as SiteView;
  const byKey = new Map(views.map((v) => [v.key, v]));
  const viewOf = (v: Partial<Variant>) => byKey.get(variantKey(v)) ?? main;

  const pagesByAddress = new Map(
    tree.pages.map((p) => [
      `${variantKey({ locale: p.locale, version: p.version })}|${p.rel}`,
      p,
    ]),
  );
  const finder: FindPage = (variant, rel) => {
    const page = pagesByAddress.get(`${variantKey(variant)}|${rel}`);
    return (
      page && {
        path: page.path,
        rel: page.rel,
        ...(page.fallbackLocale && { fallbackLocale: page.fallbackLocale }),
      }
    );
  };
  const homeOf = (variant: Variant) =>
    urlPrefix + variantPrefix(config, variant) || '/';

  // Every page renders the graph, so build it once per view, not once per page.
  const graphs = new Map<string, Promise<PageGraph>>();
  const icons = await loadIconPacks(root, config);
  let fullIndex: Promise<ContentIndex> | undefined;
  const loadIndex = () =>
    (fullIndex ??= (async () => {
      if (process.env.NODE_ENV === 'production') {
        const built = await readIndexFile(root);
        if (built) return built;
      }
      const { index: fresh } = await buildSiteIndex({
        root,
        docsDir: dir,
        config,
        tree,
        previous: lastIndex.get(root),
      });
      lastIndex.set(root, fresh);
      return fresh;
    })()).catch((error: unknown) => {
      fullIndex = undefined;
      throw error;
    });
  const publicForms = new WeakMap<ContentIndex, ContentIndex>();
  const scoped = new WeakMap<ContentIndex, Map<string, ContentIndex>>();
  const publicOf = (full: ContentIndex) => {
    let open = publicForms.get(full);
    if (!open) publicForms.set(full, (open = publicIndex(full, config)));
    return open;
  };

  const site: Site = {
    index: async () => publicOf(await loadIndex()),
    indexFor: async (viewer) => {
      const full = await loadIndex();
      if (viewer.scope === '') return publicOf(full);
      let forms = scoped.get(full);
      if (!forms) scoped.set(full, (forms = new Map()));
      let index = forms.get(viewer.scope);
      if (!index) {
        // Few distinct scopes exist (one per combination of rules passed); the cap guards against surprises.
        if (forms.size >= 64) forms.clear();
        forms.set(
          viewer.scope,
          (index = filterIndex(full, (p) => viewer.canSee(p.path))),
        );
      }
      return index;
    },
    icons,
    root,
    config,
    tree,
    nav: main.nav,
    views,
    view: (variant) => (variant ? viewOf(variant) : main),
    viewOf: (page) => viewOf({ locale: page.locale, version: page.version }),
    navFor: (page) => {
      const view = viewOf({ locale: page.locale, version: page.version });
      return isProtected(page.path) ? view.nav : view.publicNav;
    },
    find: (slug = []) =>
      tree.pages.find((p) => p.slug.join('/') === slug.join('/')),
    redirectFor: (slug) => {
      const parsed = parseVariantPath(config, slug);
      if (!parsed.redundant) return undefined;
      const short = [
        ...variantPrefix(config, parsed.variant).split('/').filter(Boolean),
        ...parsed.rest,
      ];
      return tree.pages.some((p) => p.slug.join('/') === short.join('/'))
        ? urlPrefix + (short.length ? `/${short.join('/')}` : '') || '/'
        : undefined;
    },
    variantUi: (page) => buildVariantUi(config, finder, page, homeOf),
    messages: (page) => messagesFor(page?.locale, config.i18n?.messages),
    finder,
    homeOf,
    lastModified: async (page) =>
      (await lastModified(join(dir, page.file))).date,
    toc: async (page) => {
      const read = (file: string) => readFile(join(dir, file), 'utf8');
      const source = await expandIncludes(await read(page.file), {
        file: page.file,
        read,
      });
      return extractToc(resolveVisibility(source, 'humans'));
    },
    source: (page) => readPageBody(dir, page, 'humans'),
    isProtected: (page) => isProtected(page.path),
    graph: (page) => {
      const view = page
        ? viewOf({ locale: page.locale, version: page.version })
        : main;
      let graph = graphs.get(view.key);
      if (!graph)
        graphs.set(
          view.key,
          (graph = buildGraph(
            {
              ...view.tree,
              pages: view.tree.pages.filter((p) => !isProtected(p.path)),
            },
            dir,
          )),
        );
      return graph;
    },
    markdown: (page, components) =>
      readPageMarkdown(dir, page, {
        components: { ...defineMdxComponents(), ...components },
      }),
    book: async ({ scope, under } = {}) => {
      const nav = (scope ? viewOf(scope) : main).full;
      const inside = (page: Page) =>
        !under ||
        under === '/' ||
        page.rel === under ||
        page.rel.startsWith(`${under.replace(/\/+$/, '')}/`);
      const ordered = [
        ...nav.tabs.flatMap((t) => flattenSidebar(t.sidebar)),
        ...nav.unlisted,
      ]
        .filter((p, i, all) => all.indexOf(p) === i)
        .filter(inside);
      // If the book page itself is protected, whoever sees it was let in and gets every page. If it is
      // open, pages behind a rule must not appear in it.
      const bookIsProtected =
        !!findAccessRule(rules, `${config.urlPrefix ?? ''}/print`) ||
        !!findAccessRule(rules, '/print');
      return Promise.all(
        ordered
          .filter((page) => bookIsProtected || !isProtected(page.path))
          .map(async (page) => ({ page, toc: await site.toc(page) })),
      );
    },
  };
  return site;
}

/**
 * The pages to build ahead of time, as route params for `generateStaticParams`. Protected pages are left out: they are
 * rendered when someone who was let in asks for them, so their text is never in the build output where a host or CDN
 * might serve it to anyone (and a static export, which has no server to guard them, does not contain them at all).
 */
export function staticParams(site: Site): { slug: string[] }[] {
  return site.tree.pages
    .filter((p) => !site.isProtected(p))
    .map((p) => ({ slug: p.slug }));
}

/**
 * What `/print` shows: `?version=v1&locale=fr` picks a version and language (the defaults otherwise) and
 * `?path=/guides` only that page and the pages below it. For the print page; `dockudos pdf` sets these.
 */
export async function bookRequest(
  site: Site,
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>,
): Promise<{ scope: Variant; under?: string; nav: Navigation }> {
  // A static export is written once, without a request to read: it prints the defaults.
  const params =
    process.env.NEXT_PUBLIC_DOCKUDOS_STATIC === '1'
      ? {}
      : ((await searchParams) ?? {});
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) || undefined;
  const { scope } = resolveScope(site.config, {
    version: one(params['version']),
    locale: one(params['locale']),
  });
  const chosen = scope ?? {};
  const under = one(params['path']);
  // Whoever may open a protected `/print` may see the whole contents; anyone else sees the public ones.
  const printIsProtected =
    !!findAccessRule(
      site.config.access.rules,
      `${site.config.urlPrefix ?? ''}/print`,
    ) || !!findAccessRule(site.config.access.rules, '/print');
  const view = site.view(chosen);
  return {
    scope: chosen,
    ...(under && { under }),
    nav: printIsProtected ? view.nav : view.publicNav,
  };
}

async function buildGraph(tree: PageTree, dir: string): Promise<PageGraph> {
  const pages = tree.pages.filter((p) => !p.hidden);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const edges = new Map<string, { from: string; to: string }>();

  await Promise.all(
    pages.map(async (page) => {
      const source = await readFile(join(dir, page.file), 'utf8');
      for (const { href, kind } of extractLinks(source)) {
        if (kind !== 'link') continue;
        const link = resolveDocLink(page.contentFile, href, {
          prefix: pageMount(page),
        });
        if (link.kind !== 'internal' || link.path === page.path) continue;
        if (!byPath.has(link.path)) continue;
        edges.set(`${page.path}>${link.path}`, {
          from: page.path,
          to: link.path,
        });
      }
    }),
  );
  return {
    nodes: pages.map((p) => ({ id: p.path, title: p.title, path: p.path })),
    edges: [...edges.values()].sort((a, b) =>
      a.from + a.to < b.from + b.to ? -1 : 1,
    ),
  };
}

/**
 * CSS for the user's theme settings (`theme.primary`, fonts, radius) followed by
 * their own stylesheet from `theme.css`. Inject it in `<head>` after the base styles.
 */
export async function siteCss(site: Site): Promise<string> {
  const { css } = site.config.theme;
  let custom = '';
  if (css) {
    try {
      custom = await readFile(join(site.root, css), 'utf8');
    } catch {
      throw new Error(`theme.css: file not found: ${css}`);
    }
  }
  return themeCss(site.config.theme) + custom;
}

/** `<link rel="alternate" type="application/rss+xml">` for the feeds that are on, or `undefined` for none. */
function feedLinks(config: DocsConfig) {
  const feeds = [
    config.feeds.changelog && {
      url: '/changelog.xml',
      title: `${config.name} changelog`,
    },
    config.feeds.posts && { url: '/rss.xml', title: config.name },
  ].filter((f): f is { url: string; title: string } => !!f);
  return feeds.length ? { 'application/rss+xml': feeds } : undefined;
}

/** Site-wide metadata for the root layout: base URL, default title and favicon. */
export function siteMetadata({ config }: Site): Metadata {
  const { siteUrl, description } = config.seo;
  const types = feedLinks(config);
  return {
    ...(types && { alternates: { types } }),
    ...(siteUrl && { metadataBase: new URL(siteUrl) }),
    title: { default: config.name, template: `%s | ${config.name}` },
    ...(description && { description }),
    ...(config.favicon && { icons: { icon: config.favicon } }),
  };
}

/** Per-page metadata: title, description, canonical URL and robots. */
export function pageMetadata(site: Site, page: Page): Metadata {
  const seo = pageSeo(site.config, page, {
    canonicalPath: canonicalPath(site.config, site.finder, page),
    alternates: pageAlternates(site.config, site.finder, page),
  });
  const languages = Object.fromEntries(
    (seo.alternates ?? []).map((a) => [a.hreflang, a.path]),
  );
  const image =
    site.config.seo.siteUrl && site.config.seo.ogImages
      ? [
          {
            url: ogImagePath(page.path),
            width: OG_SIZE.width,
            height: OG_SIZE.height,
            alt: page.title,
          },
        ]
      : undefined;
  return {
    // Absolute, because `pageSeo` already applied the site name.
    title: { absolute: seo.title },
    ...(image && {
      openGraph: {
        title: page.title,
        ...(seo.description && { description: seo.description }),
        images: image,
      },
      twitter: {
        card: 'summary_large_image' as const,
        images: image.map((i) => i.url),
      },
    }),
    ...(seo.description && { description: seo.description }),
    // (A page's `alternates` replace the site's, so the feeds are named here too.)
    ...(seo.canonical && {
      alternates: {
        canonical: seo.canonical,
        ...(seo.alternates?.length && { languages }),
        ...(feedLinks(site.config) && { types: feedLinks(site.config) }),
      },
    }),
    ...(seo.noindex || site.isProtected(page)
      ? { robots: { index: false, follow: false } }
      : // A page shown in place of a translation is not the language's page: followed, not indexed.
        page.fallbackLocale && { robots: { index: false, follow: true } }),
  };
}

/** `GET` handler for `app/sitemap.xml/route.ts`. 404 when `seo.siteUrl` is not set. */
export async function sitemapResponse(site?: Site): Promise<Response> {
  const s = site ?? (await getSite());
  const open = s.tree.pages.filter((p) => !s.isProtected(p));
  const dates = new Map(
    await Promise.all(
      open.map(async (p) => [p, await s.lastModified(p)] as const),
    ),
  );
  const xml = buildSitemap(
    s.config,
    open,
    (p) => dates.get(p),
    s.config.versions || s.config.i18n
      ? { config: s.config, find: s.finder }
      : undefined,
  );
  if (!xml) return new Response('Not found', { status: 404 });
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

/** `GET` handler for `app/robots.txt/route.ts`. */
export async function robotsResponse(site?: Site): Promise<Response> {
  const s = site ?? (await getSite());
  return new Response(buildRobots(s.config), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
