import {
  type ContentIndex,
  type DocsConfig,
  type Navigation,
  type Page,
  type PageTree,
  buildNavigation,
  buildRobots,
  buildSitemap,
  expandIncludes,
  resolveVisibility,
  findAccessRule,
  flattenSidebar,
  extractLinks,
  resolveDocLink,
  extractToc,
  pageSeo,
  themeCss,
  type SvgIcon,
  type MarkdownComponents,
  type TocEntry,
} from '@dockudos/core';
import {
  buildSiteIndex,
  discoverPages,
  lastModified,
  loadConfig,
  loadIconPacks,
  readIndexFile,
  readPageMarkdown,
} from '@dockudos/core/node';
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

/** Everything the routes need to know about the site, read from `docs.json` and the docs folder. */
export interface Site {
  /** Absolute project root. */
  root: string;
  config: DocsConfig;
  tree: PageTree;
  nav: Navigation;
  /** Find a page by its URL segments; no segments is the home page. */
  find(slug?: readonly string[]): Page | undefined;
  /** When the page's source file last changed (Git, else file system). */
  lastModified(page: Page): Promise<Date>;
  /** Headings of the page (h2 to h4), with `<include>`s expanded, matching the ids in the rendered page. */
  toc(page: Page): Promise<TocEntry[]>;
  /** Visible pages and the links between them, for `<GraphView />`. */
  graph(): Promise<PageGraph>;
  /**
   * Every page in reading order, for one long document (print or PDF): the pages of each tab in
   * navigation order, then visible pages the navigation does not list.
   */
  book(): Promise<{ page: Page; toc: TocEntry[] }[]>;
  /**
   * The page as plain Markdown: title and description, then the content with `<include>`s expanded and
   * frontmatter removed. For "copy page", `llms.txt`-style exports and AI assistants.
   */
  /** A page as Markdown. `components` are the site's own, added to the built-in ones. */
  markdown(page: Page, components?: MarkdownComponents): Promise<string>;
  /**
   * The content index of the public pages (not hidden, not behind an access rule): search, the assistant,
   * `llms.txt` and the MCP server all read it. In production it is the file `dockudos build` wrote,
   * else it is built from the files, reusing what did not change since the last call.
   */
  index(): Promise<ContentIndex>;
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
  const config = await loadConfig(root);
  const tree = await discoverPages(dir, { prefix: config.urlPrefix });
  // Every page renders the graph, so build it once per site, not once per page.
  let graph: Promise<PageGraph> | undefined;
  const rules = config.access.rules;
  const isProtected = (path: string) => !!findAccessRule(rules, path);
  const built = buildNavigation(config, tree);
  // Pages the author did not list are not advertised (search, "More" lists) when they sit behind a rule.
  // Pages the author listed stay in the navigation: that is their choice.
  const nav = {
    ...built,
    unlisted: built.unlisted.filter((p) => !isProtected(p.path)),
  };
  const icons = await loadIconPacks(root, config);
  let index: Promise<ContentIndex> | undefined;
  const site: Site = {
    index: () =>
      (index ??= (async () => {
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
        index = undefined;
        throw error;
      }),
    icons,
    root,
    config,
    tree,
    nav,
    find: (slug = []) =>
      tree.pages.find((p) => p.slug.join('/') === slug.join('/')),
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
    isProtected: (page) => isProtected(page.path),
    graph: () =>
      (graph ??= buildGraph(
        { ...tree, pages: tree.pages.filter((p) => !isProtected(p.path)) },
        dir,
        config.urlPrefix,
      )),
    markdown: (page, components) =>
      readPageMarkdown(dir, page, {
        components: { ...defineMdxComponents(), ...components },
      }),
    book: async () => {
      const ordered = [
        ...nav.tabs.flatMap((t) => flattenSidebar(t.sidebar)),
        ...built.unlisted,
      ].filter((p, i, all) => all.indexOf(p) === i);
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

async function buildGraph(
  tree: PageTree,
  dir: string,
  prefix?: string,
): Promise<PageGraph> {
  const pages = tree.pages.filter((p) => !p.hidden);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const edges = new Map<string, { from: string; to: string }>();

  await Promise.all(
    pages.map(async (page) => {
      const source = await readFile(join(dir, page.file), 'utf8');
      for (const { href, kind } of extractLinks(source)) {
        if (kind !== 'link') continue;
        const link = resolveDocLink(page.file, href, { prefix });
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

/** Site-wide metadata for the root layout: base URL, default title and favicon. */
export function siteMetadata({ config }: Site): Metadata {
  const { siteUrl, description } = config.seo;
  return {
    ...(siteUrl && { metadataBase: new URL(siteUrl) }),
    title: { default: config.name, template: `%s | ${config.name}` },
    ...(description && { description }),
    ...(config.favicon && { icons: { icon: config.favicon } }),
  };
}

/** Per-page metadata: title, description, canonical URL and robots. */
export function pageMetadata(site: Site, page: Page): Metadata {
  const seo = pageSeo(site.config, page);
  return {
    // Absolute, because `pageSeo` already applied the site name.
    title: { absolute: seo.title },
    ...(seo.description && { description: seo.description }),
    ...(seo.canonical && { alternates: { canonical: seo.canonical } }),
    ...((seo.noindex || site.isProtected(page)) && {
      robots: { index: false, follow: false },
    }),
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
  const xml = buildSitemap(s.config, open, (p) => dates.get(p));
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
