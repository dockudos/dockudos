import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { StorageError, openClientStorage } from './client-db.ts';

/**
 * The paths that only a browser in a bad mood takes: a transaction that gives up, a database another tab is holding
 * open, settings that cannot be read, and the first render on the server, where there is no storage at all.
 */

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a store that misbehaves', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

  it('gives back nothing when a read fails halfway', async () => {
    const storage = await openClientStorage();
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      const request = { onsuccess: null, onerror: null, error: new Error('read failed') } as unknown as IDBRequest & {
        onerror: ((e: unknown) => void) | null;
      };
      setTimeout(() => request.onerror?.(new Event('error')), 0);
      return request as IDBRequest;
    });
    expect((await storage.read()).requests).toEqual([]);
  });

  it('reports a transaction that was given up on', async () => {
    const storage = await openClientStorage();
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(
      () =>
        ({
          objectStore: () => ({ put: () => undefined }),
          error: new Error('gave up'),
          set onabort(listener: () => void) {
            setTimeout(listener, 0);
          },
        }) as unknown as IDBTransaction,
    );
    const refused = await storage
      .put('requests', [{ id: 'r1', request: { url: 'https://api.test' } }])
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StorageError);
    expect((refused as StorageError).message).toMatch(/gave up/);
  });

  it('carries on in memory when another tab is holding the database open', async () => {
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
      const request = { onblocked: null } as unknown as IDBOpenDBRequest & {
        onblocked: ((e: unknown) => void) | null;
      };
      setTimeout(() => request.onblocked?.(new Event('blocked')), 0);
      return request as IDBOpenDBRequest;
    });
    const storage = await openClientStorage();
    expect(storage.kind).toBe('memory');
    expect(storage.notice).toMatch(/older version/);
  });

  it('starts from the defaults when the saved settings cannot be read', async () => {
    localStorage.setItem('dockudos-api-client-prefs', '{nope');
    vi.resetModules();
    const store = await import('./client-store.ts');
    await store.loadClient();
    expect(store.clientSnapshot()).toMatchObject({
      rememberSecrets: false,
      historyWithSecrets: false,
    });
  });

  it('keeps a request saved while the store was still opening', async () => {
    vi.resetModules();
    const store = await import('./client-store.ts');
    const first = await openClientStorage();
    await first.put('collections', [
      { id: 'c-on-disk', name: 'From disk', order: 1, createdAt: 1, v: 1 },
    ]);
    first.close();

    // The reader saves before the store has finished opening: both records survive.
    const loading = store.loadClient();
    const saved = store.saveRequest({
      request: { method: 'GET', url: 'https://api.test/pets', headers: [] },
    });
    await loading;
    expect(store.clientSnapshot().requests.map((r) => r.id)).toEqual([saved.id]);
    expect(store.clientSnapshot().collections.map((c) => c.name)).toContain('From disk');
  });
});

describe('the first render, where there is no browser yet', () => {
  it('renders the client and the picker as empty on the server', async () => {
    vi.resetModules();
    const { LazyApiClient } = await import('./client-lazy.tsx');
    const { useApiClient } = await import('./client-store.ts');
    const { useEnvironment } = await import('./client-env.ts');

    const Probe = () => {
      const client = useApiClient();
      const environment = useEnvironment();
      return (
        <p>{`${client.where} ${client.collections.length} ${environment.environments.length}`}</p>
      );
    };
    expect(renderToString(<Probe />)).toContain('loading 0 0');
    expect(renderToString(<LazyApiClient />)).toContain('Loading the API client…');
  });
});

describe('the client that loads on demand', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

  it('fetches the client when a page asks for it', async () => {
    vi.resetModules();
    const { LazyApiClient, LazyApiClientPanel } = await import('./client-lazy.tsx');
    const page = render(<LazyApiClient title="API client" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the API client…');
    expect(
      await screen.findByRole('heading', { name: 'API client' }),
    ).toBeInTheDocument();
    page.unmount();

    render(<LazyApiClientPanel onClose={() => undefined} />);
    expect(await screen.findByRole('dialog', { name: 'API client' })).toBeInTheDocument();
  });

  it('writes itself as a note in Markdown', async () => {
    const { LazyApiClient } = await import('./client-lazy.tsx');
    expect(await LazyApiClient.toMarkdown()).toMatch(/An API client runs/);
  });

  it('notes a sent request in the history, fetching the store to do it', async () => {
    vi.resetModules();
    const { noteSentRequest } = await import('./client-lazy.tsx');
    const store = await import('./client-store.ts');
    await noteSentRequest({
      request: { method: 'GET', url: 'https://api.test/pets', headers: [] },
      status: 200,
      ms: 5,
    });
    await waitFor(() => expect(store.clientSnapshot().history).toHaveLength(1));
    expect(store.clientSnapshot().history[0]).toMatchObject({ status: 200, ms: 5 });
  });
});
