import { type ContentIndex, KeywordSearch } from '@dockudos/core';

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
