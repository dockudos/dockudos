'use client';

import { type ComponentProps, Suspense, lazy } from 'react';
import type { ApiClient, ApiClientPanel } from './client.tsx';
import type { RecordInput } from './client-store.ts';

/**
 * The API client is fetched when a reader opens it, not with every endpoint page: it brings the storage layer, the
 * import and export converters and its own interface, which a reader who only wants to read the docs never needs.
 *
 * `apps/example/e2e/bundle.spec.ts` keeps that true: the chunk with the client in it must not be part of what a page
 * loads to begin with.
 */

const Impl = lazy(() =>
  import('./client.tsx').then((m) => ({ default: m.ApiClient })),
);

const PanelImpl = lazy(() =>
  import('./client.tsx').then((m) => ({ default: m.ApiClientPanel })),
);

const Loading = () => (
  <div className="dk-api-status" role="status">
    Loading the API client…
  </div>
);

/** `ApiClient`, loaded on first use. This is what MDX pages get as `<ApiClient />`. */
export function LazyApiClient(props: ComponentProps<typeof ApiClient>) {
  return (
    <Suspense fallback={<Loading />}>
      <Impl {...props} />
    </Suspense>
  );
}

LazyApiClient.toMarkdown = (() =>
  'An API client runs on this page in the browser: saved requests, environments, history, and import and export.') satisfies typeof ApiClient.toMarkdown;

/** `ApiClientPanel`, loaded when the playground's Save or Collections button is pressed. */
export function LazyApiClientPanel(props: ComponentProps<typeof ApiClientPanel>) {
  return (
    <Suspense fallback={<Loading />}>
      <PanelImpl {...props} />
    </Suspense>
  );
}

/**
 * Note a request the playground sent in the client's history. The store comes with the same chunk as the client, so a
 * reader who never sends anything never downloads it.
 */
export async function noteSentRequest(input: RecordInput): Promise<void> {
  const store = await import('./client-store.ts');
  await store.loadClient();
  store.recordSent(input);
}
