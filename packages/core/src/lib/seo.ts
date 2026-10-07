import type { DocsConfig } from './config.ts';
import type { Page } from './page-tree.ts';

type SeoConfig = Pick<DocsConfig, 'name' | 'seo'>;

export interface PageSeo {
  /** Full `<title>`: `Page | Site`, or just the site name for the home page. */
  title: string;
  description?: string;
  /** Absolute canonical URL; absent when `seo.siteUrl` is not configured. */
  canonical?: string;
  noindex: boolean;
}

/** Join `siteUrl` and a page path without doubling slashes. */
export function canonicalUrl(siteUrl: string, path: string): string {
  const origin = siteUrl.replace(/\/+$/, '');
  return path === '/' ? `${origin}/` : `${origin}${path}`;
}

export function pageSeo(config: SeoConfig, page: Page): PageSeo {
  const seo: PageSeo = {
    title: page.path === '/' ? config.name : `${page.title} | ${config.name}`,
    noindex: config.seo.noindex || page.hidden,
  };
  const description = page.description ?? config.seo.description;
  if (description) seo.description = description;
  if (config.seo.siteUrl)
    seo.canonical = canonicalUrl(config.seo.siteUrl, page.path);
  return seo;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `sitemap.xml` for every indexable page. Returns `undefined` without `seo.siteUrl`, since entries must be absolute. */
export function buildSitemap(
  config: SeoConfig,
  pages: readonly Page[],
  lastModified: (page: Page) => Date | undefined = () => undefined,
): string | undefined {
  const { siteUrl, noindex } = config.seo;
  if (!siteUrl || noindex) return undefined;
  const urls = pages
    .filter((p) => !p.hidden)
    .map((p) => {
      const date = lastModified(p);
      const lastmod = date ? `<lastmod>${date.toISOString()}</lastmod>` : '';
      return `  <url><loc>${escapeXml(canonicalUrl(siteUrl, p.path))}</loc>${lastmod}</url>`;
    });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** `robots.txt`: allow everything and point at the sitemap, or disallow everything when `seo.noindex` is set. */
export function buildRobots(config: SeoConfig): string {
  const { siteUrl, noindex } = config.seo;
  const lines = ['User-agent: *', noindex ? 'Disallow: /' : 'Allow: /'];
  if (siteUrl && !noindex)
    lines.push('', `Sitemap: ${canonicalUrl(siteUrl, '/sitemap.xml')}`);
  return lines.join('\n') + '\n';
}
