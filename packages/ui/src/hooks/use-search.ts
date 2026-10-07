'use client';

import {
  type DocsConfig,
  type SearchClient,
  type SearchHit,
  createEndpointBackend,
  createKeywordBackend,
  createSearchClient,
  fetchIndex,
} from '@dockudos/core';
import { useEffect, useMemo, useState } from 'react';
import { useSearchBackend } from '../provider.tsx';

/** The part of `docs.json`'s `search` key the browser needs. */
export type SearchSettings = Partial<
  Pick<DocsConfig['search'], 'backend' | 'endpoint' | 'limit'>
>;

export const DEFAULT_SEARCH_ENDPOINT = '/api/search';

/**
 * The search client for the site: the backend given to `DocsProvider`, else the one `search` in
 * docs.json selects. Nothing is downloaded until the first search. `undefined` without settings.
 */
export function useSearchClient(
  settings: SearchSettings | undefined,
): SearchClient | undefined {
  const provided = useSearchBackend();
  const backend = settings?.backend ?? 'builtin';
  const endpoint = settings?.endpoint ?? DEFAULT_SEARCH_ENDPOINT;
  const enabled = !!settings || !!provided;
  return useMemo(() => {
    if (!enabled) return undefined;
    if (provided) return createSearchClient(provided);
    if (backend === 'builtin')
      return createSearchClient(
        createKeywordBackend(fetchIndex(`${endpoint}/index`)),
      );
    return createSearchClient(createEndpointBackend(endpoint, { id: backend }));
  }, [enabled, provided, backend, endpoint]);
}

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchState {
  hits: SearchHit[];
  status: SearchStatus;
  /** The query `hits` answer, which can trail the one being typed. */
  query: string;
}

/**
 * Search as the query changes. The previous results stay until the new ones arrive, and an answer to an
 * older query never replaces a newer one. Servers get a short pause so typing does not send a request per key.
 */
export function useSearch(
  client: SearchClient | undefined,
  query: string,
  { limit = 10, maxPerPage = 2 }: { limit?: number; maxPerPage?: number } = {},
): SearchState {
  const [state, setState] = useState<SearchState>({
    hits: [],
    status: 'idle',
    query: '',
  });
  const remote = client ? client.backend.id !== 'builtin' : false;

  useEffect(() => {
    const q = query.trim();
    if (!client || !q) {
      setState({ hits: [], status: 'idle', query: '' });
      return;
    }
    let current = true;
    setState((s) => ({ ...s, status: 'loading' }));
    const timer = setTimeout(
      () => {
        client.search(q, { limit, maxPerPage }).then(
          (hits) => current && setState({ hits, status: 'ready', query: q }),
          () => current && setState({ hits: [], status: 'error', query: q }),
        );
      },
      remote ? 150 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, query, limit, maxPerPage, remote]);

  return state;
}
