import {
  type DocsConfig,
  type Navigation,
  type Page,
  type PageTree,
  buildNavigation,
  buildRobots,
  buildSitemap,
  pageSeo,
} from '@dockudos/core';
import { discoverPages, lastModified, loadConfig } from '@dockudos/core/node';
import type { Metadata } from 'next';
import { join, resolve } from 'node:path';

export interface SiteOptions {
  /** Project root, where `docs.json` lives. Default `process.cwd()`. */
  root?: string;
  /** Folder with the MDX files, relative to `root`. Default `docs`. */
  docsDir?: string;
}

/** Everything the routes need to know about the site, read from `docs.json` and the docs folder. */
export interface Site {
  config: DocsConfig;
  tree: PageTree;
  nav: Navigation;
  /** Find a page by its URL segments; no segments is the home page. */
  find(slug?: readonly string[]): Page | undefined;
  /** When the page's source file last changed (Git, else file system). */
  lastModified(page: Page): Promise<Date>;
}

const cache = new Map<string, Promise<Site>>();

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
  const [config, tree] = await Promise.all([
    loadConfig(root),
    discoverPages(dir),
  ]);
  return {
    config,
    tree,
    nav: buildNavigation(config, tree),
    find: (slug = []) =>
      tree.pages.find((p) => p.slug.join('/') === slug.join('/')),
    lastModified: async (page) =>
      (await lastModified(join(dir, page.file))).date,
  };
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
    ...(seo.noindex && { robots: { index: false, follow: false } }),
  };
}

/** `GET` handler for `app/sitemap.xml/route.ts`. 404 when `seo.siteUrl` is not set. */
export async function sitemapResponse(site?: Site): Promise<Response> {
  const s = site ?? (await getSite());
  const dates = new Map(
    await Promise.all(
      s.tree.pages.map(async (p) => [p, await s.lastModified(p)] as const),
    ),
  );
  const xml = buildSitemap(s.config, s.tree.pages, (p) => dates.get(p));
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
