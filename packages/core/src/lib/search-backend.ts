import type { ContentIndex } from './content-index.ts';
import {
  KeywordSearch,
  type SearchBackend,
  type SearchHit,
  type SearchOptions,
} from './keyword-search.ts';

type MaybePromise<T> = T | Promise<T>;

/**
 * The built-in backend: the keyword engine over a content index. The index is loaded on the first
 * search, so a page that never searches never downloads it. A failed load is retried on the next search.
 */
export function createKeywordBackend(
  load: () => MaybePromise<ContentIndex>,
): SearchBackend {
  let engine: Promise<KeywordSearch> | undefined;
  return {
    id: 'builtin',
    async search(query, options) {
      engine ??= Promise.resolve(load()).then(
        (index) => new KeywordSearch(index),
        (error: unknown) => {
          engine = undefined;
          throw error;
        },
      );
      return (await engine).search(query, options);
    },
  };
}

export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Which version and language a search is about. A site with neither leaves it empty. */
export interface SearchScope {
  locale?: string;
  version?: string;
}

/**
 * Where the browser loads the index from. A server answers `…/index?version=v1&locale=fr`; a static site has no
 * server to read the query, so each version and language is its own file, `…/index-v1~fr`. A site with neither has
 * `…/index` either way.
 */
export function searchIndexUrl(
  endpoint: string,
  scope: SearchScope = {},
  asFile = false,
): string {
  const parts = [scope.version, scope.locale].filter(Boolean) as string[];
  if (parts.length === 0) return `${endpoint}/index`;
  if (asFile) return `${endpoint}/index-${parts.join('~')}`;
  const params = new URLSearchParams();
  if (scope.version) params.set('version', scope.version);
  if (scope.locale) params.set('locale', scope.locale);
  return `${endpoint}/index?${params}`;
}

/** Load the content index from the endpoint that serves it (`/api/search/index`). */
export function fetchIndex(
  url: string,
  fetcher: Fetcher = (u, init) => fetch(u, init),
): () => Promise<ContentIndex> {
  return async () => {
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error(`Could not load the search index (${response.status}).`);
    return (await response.json()) as ContentIndex;
  };
}

function isHit(value: unknown): value is SearchHit {
  const v = value as Partial<SearchHit> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.url === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.headingPath) &&
    !!v.snippet &&
    typeof v.snippet.text === 'string'
  );
}

/**
 * A backend that asks a server: `GET <endpoint>?q=…&limit=…` answering `{ hits: SearchHit[] }`. The
 * built-in `/api/search` route speaks it, and so can your own service (`search.backend: "custom"`).
 * Options that are functions (`filter`) cannot cross the network and are ignored.
 */
export function createEndpointBackend(
  endpoint: string,
  {
    fetcher = (u, init) => fetch(u, init),
    id = 'endpoint',
    scope = {},
  }: {
    fetcher?: Fetcher;
    id?: string;
    /** Sent along so the answer only covers this version and language. */
    scope?: SearchScope;
  } = {},
): SearchBackend {
  return {
    id,
    async search(query, options = {}) {
      const params = new URLSearchParams({ q: query });
      if (options.limit) params.set('limit', String(options.limit));
      if (options.maxPerPage)
        params.set('maxPerPage', String(options.maxPerPage));
      if (scope.version) params.set('version', scope.version);
      if (scope.locale) params.set('locale', scope.locale);
      const separator = endpoint.includes('?') ? '&' : '?';
      const response = await fetcher(`${endpoint}${separator}${params}`);
      if (!response.ok) throw new Error(`Search failed (${response.status}).`);
      const body = (await response.json()) as { hits?: unknown };
      if (!Array.isArray(body.hits))
        throw new Error('The search endpoint did not return { hits: [...] }.');
      return body.hits.filter(isHit);
    },
  };
}

/** What the search UI talks to. Wraps any backend with trimming, caching and request sharing. */
export interface SearchClient {
  readonly backend: SearchBackend;
  search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
}

export interface SearchClientOptions {
  /** How many recent queries to remember. Default 50. */
  cacheSize?: number;
}

/**
 * The one entry point for search UIs. Blank queries answer empty without calling the backend, repeated
 * queries answer from memory, and identical queries in flight share one request. Errors are not cached.
 */
export function createSearchClient(
  backend: SearchBackend,
  { cacheSize = 50 }: SearchClientOptions = {},
): SearchClient {
  const cache = new Map<string, Promise<SearchHit[]>>();
  return {
    backend,
    search(query, options = {}) {
      const q = query.trim().replace(/\s+/g, ' ');
      if (q === '') return Promise.resolve([]);
      // A function in the options cannot be part of a cache key, so such queries go straight through.
      if (options.filter) return Promise.resolve(backend.search(q, options));
      const key = JSON.stringify([q, options.limit, options.maxPerPage]);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key); // most recently used goes last
        cache.set(key, cached);
        return cached;
      }
      const pending = Promise.resolve(backend.search(q, options));
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
      if (cache.size > cacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return pending;
    },
  };
}
