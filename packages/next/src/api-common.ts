import {
  type ContentIndex,
  type DocsConfig,
  type PageRecord,
  type Variant,
  KeywordSearch,
  resolveScope,
} from '@dockudos/core';

export const MAX_QUERY_LENGTH = 300;
export const MAX_LIMIT = 50;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** A JSON error with a message a person can act on. */
export const apiError = (
  status: number,
  message: string,
  headers: Record<string, string> = {},
) =>
  json({ error: message }, status, { 'cache-control': 'no-store', ...headers });

// One engine per index object: building it is the expensive part of a search.
const engines = new WeakMap<ContentIndex, KeywordSearch>();
export function engineFor(index: ContentIndex): KeywordSearch {
  let engine = engines.get(index);
  if (!engine) engines.set(index, (engine = new KeywordSearch(index)));
  return engine;
}

export const MAX_BODY_BYTES = 32 * 1024;

/**
 * Who is asking, for rate limiting. Takes the address the platform or proxy in front of the site reports.
 * Behind a proxy you do not control, anyone can send these headers; the shared ceiling in the AI routes
 * still caps the total.
 */
export function clientKey(request: Request): string {
  const h = request.headers;
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    h.get('cf-connecting-ip')?.trim() ||
    h.get('x-real-ip')?.trim() ||
    forwarded ||
    'unknown'
  ).slice(0, 64);
}

/**
 * The version and language a request is about, from `?version=&locale=` (or the same in a JSON body). What is
 * left out is the site's default, so a request never reaches across versions or languages by accident. A name the
 * site does not have is a 400.
 */
export function requestScope(
  config: Pick<DocsConfig, 'versions' | 'i18n'>,
  asked: { version?: string | null; locale?: string | null },
): { scope: Variant } | { response: Response } {
  const { scope, error } = resolveScope(config, {
    version: asked.version || undefined,
    locale: asked.locale || undefined,
  });
  return error || !scope
    ? { response: apiError(400, error ?? 'Unknown scope.') }
    : { scope };
}

/** Pages of one version and language. */
export const inScope =
  (scope: Variant) =>
  (page: PageRecord): boolean =>
    (scope.locale === undefined || page.locale === scope.locale) &&
    (scope.version === undefined || page.version === scope.version);

/**
 * The address a request was made to, or `undefined` in a static export, where a route is written once and has no request
 * to read (touching `request.url` there fails the export).
 */
export function requestUrl(request?: Request): URL | undefined {
  if (!request || process.env.NEXT_PUBLIC_DOCKUDOS_STATIC === '1')
    return undefined;
  return new URL(request.url);
}
