import type { NavigateResult } from '@dockudos/core';

export type NavigationOutcome =
  | { kind: 'found'; result: NavigateResult }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

/**
 * Ask the navigate route where a request should go. Never rejects: "nothing matches" and failures are
 * outcomes, with a message that can be shown to the reader.
 */
export async function requestNavigation(
  query: string,
  {
    endpoint = '/api/navigate',
    fetch: doFetch = (url, init) => globalThis.fetch(url, init),
    signal,
  }: { endpoint?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<NavigationOutcome> {
  try {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
    if (response.status === 404) return { kind: 'none' };
    if (!response.ok) {
      let message = `Could not find a page (${response.status}).`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* not JSON */
      }
      return { kind: 'error', message };
    }
    const result = (await response.json()) as NavigateResult;
    if (typeof result.url !== 'string' || !result.url.startsWith('/'))
      return { kind: 'error', message: 'The answer did not name a page.' };
    return { kind: 'found', result };
  } catch {
    return {
      kind: 'error',
      message:
        'Could not reach the server. Check your connection and try again.',
    };
  }
}
