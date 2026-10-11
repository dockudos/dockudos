import { findAccessRule } from './access.ts';
import type { DocsConfig } from './config.ts';
import type { ChunkRecord, ContentIndex, PageRecord } from './content-index.ts';
import type { Variant } from './variants.ts';

/** A copy of the index with only the pages `keep` approves, and their chunks. Nothing else is shared with the rest. */
export function filterIndex(
  index: ContentIndex,
  keep: (page: PageRecord) => boolean,
): ContentIndex {
  const pages = index.pages.filter(keep);
  const paths = new Set(pages.map((p) => p.path));
  return {
    ...index,
    pages,
    chunks: index.chunks.filter((c) => paths.has(c.pagePath)),
  };
}

/**
 * The index as an anonymous visitor may see it: no page behind an `access` rule. This is the only form of the index
 * that is ever written into static files, served from a cache, or handed to a tool that holds no credentials.
 */
export function publicIndex(
  index: ContentIndex,
  config: Pick<DocsConfig, 'access'>,
): ContentIndex {
  const rules = config.access.rules;
  if (rules.length === 0) return index;
  return filterIndex(index, (p) => !findAccessRule(rules, p.path));
}

/**
 * A retrieval filter for one reader: chunks of pages in the reader's version and language, and pages the reader
 * may see. A dimension the site does not have (no `versions`, no `i18n`) is not checked; when the site has it, a
 * page without a matching value is left out, never let in.
 */
export function scopeFilter(
  scope: Variant,
  canSee: (path: string) => boolean = () => true,
): (chunk: ChunkRecord, page: PageRecord) => boolean {
  return (_chunk, page) =>
    (scope.locale === undefined || page.locale === scope.locale) &&
    (scope.version === undefined || page.version === scope.version) &&
    canSee(page.path);
}

export interface RequestedScope {
  scope?: Variant;
  /** Set when the request names a version or language the site does not have. */
  error?: string;
}

/**
 * The version and language a request is about. Anything the site does not have is an error; what is left out
 * is the default, so a request never searches across versions or languages.
 */
export function resolveScope(
  config: Pick<DocsConfig, 'versions' | 'i18n'>,
  asked: { version?: string; locale?: string },
): RequestedScope {
  const scope: Variant = {};
  if (config.versions) {
    const version = asked.version ?? config.versions.default;
    if (!config.versions.list.some((v) => v.name === version))
      return { error: `Unknown version "${version}".` };
    scope.version = version;
  }
  if (config.i18n) {
    const locale = asked.locale ?? config.i18n.default;
    const known = config.i18n.locales.some(
      (l) => (typeof l === 'string' ? l : l.code) === locale,
    );
    if (!known) return { error: `Unknown language "${locale}".` };
    scope.locale = locale;
  }
  return { scope };
}
