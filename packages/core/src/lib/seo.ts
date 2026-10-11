import type { DocsConfig } from './config.ts';
import type { Page } from './page-tree.ts';
import {
  type Alternate,
  type FindPage,
  type Variant,
  alternates,
} from './variants.ts';

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

export interface SeoExtras {
  /** The path search engines should treat as the page's one address (see `canonicalPath`). Default: its own. */
  canonicalPath?: string;
  /** The same page in other languages, for `hreflang`. */
  alternates?: readonly Alternate[];
}

export function pageSeo(
  config: SeoConfig,
  page: Page,
  extras: SeoExtras = {},
): PageSeo & { alternates?: Alternate[] } {
  const seo: PageSeo & { alternates?: Alternate[] } = {
    title: page.path === '/' ? config.name : `${page.title} | ${config.name}`,
    noindex: config.seo.noindex || page.hidden,
  };
  const description = page.description ?? config.seo.description;
  if (description) seo.description = description;
  if (config.seo.siteUrl) {
    seo.canonical = canonicalUrl(
      config.seo.siteUrl,
      extras.canonicalPath ?? page.path,
    );
    if (extras.alternates?.length)
      seo.alternates = extras.alternates.map((a) => ({
        hreflang: a.hreflang,
        path: canonicalUrl(config.seo.siteUrl as string, a.path),
      }));
  }
  return seo;
}

type VariantConfig = Pick<DocsConfig, 'versions' | 'i18n'>;

/**
 * The address search engines should index for a page. An untranslated page (shown in place of a translation)
 * counts as the original-language page; a page of an older version counts as the same page of the latest version
 * when that exists. Otherwise the page is its own canonical.
 */
export function canonicalPath(
  config: VariantConfig,
  find: FindPage,
  page: Pick<Page, 'path' | 'rel' | 'locale' | 'version' | 'fallbackLocale'>,
): string {
  let path = page.path;
  let locale = page.locale;
  if (page.fallbackLocale) {
    const original = find(
      { locale: page.fallbackLocale, version: page.version },
      page.rel,
    );
    if (original) {
      path = original.path;
      locale = page.fallbackLocale;
    }
  }
  const latest = config.versions?.default;
  if (latest && page.version && page.version !== latest) {
    const there = find({ locale, version: latest } as Variant, page.rel);
    if (there && !there.fallbackLocale) path = there.path;
  }
  return path;
}

/** `hreflang` alternates for a page, empty on a site with one language. */
export function pageAlternates(
  config: VariantConfig,
  find: FindPage,
  page: Pick<Page, 'rel' | 'version' | 'fallbackLocale'>,
): Alternate[] {
  return page.fallbackLocale ? [] : alternates(config, find, page);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `sitemap.xml` for every indexable page. Returns `undefined` without `seo.siteUrl`, since entries must be absolute. */
export function buildSitemap(
  config: SeoConfig,
  pages: readonly Page[],
  lastModified: (page: Page) => Date | undefined = () => undefined,
  /** For sites with versions or languages: only pages that are their own canonical are listed, with their translations. */
  variants?: { config: VariantConfig; find: FindPage },
): string | undefined {
  const { siteUrl, noindex } = config.seo;
  if (!siteUrl || noindex) return undefined;
  const listed = pages.filter(
    (p) =>
      !p.hidden &&
      !p.fallbackLocale &&
      (!variants ||
        canonicalPath(variants.config, variants.find, p) === p.path),
  );
  const urls = listed.map((p) => {
    const date = lastModified(p);
    const lastmod = date ? `<lastmod>${date.toISOString()}</lastmod>` : '';
    const alt = variants
      ? pageAlternates(variants.config, variants.find, p)
      : [];
    const links = alt
      .map(
        (a) =>
          `<xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(canonicalUrl(siteUrl, a.path))}"/>`,
      )
      .join('');
    return `  <url><loc>${escapeXml(canonicalUrl(siteUrl, p.path))}</loc>${lastmod}${links}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
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
