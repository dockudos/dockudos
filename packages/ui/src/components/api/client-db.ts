import {
  type ClientData,
  CLIENT_LIMITS,
  type Collection,
  type Environment,
  type HistoryEntry,
  type ResponseExample,
  type SavedRequest,
  emptyClientData,
  migrateCollection,
  migrateEnvironment,
  migrateHistoryEntry,
  migrateResponseExample,
  migrateSavedRequest,
} from '@dockudos/core';

/**
 * Where the API client keeps the reader's collections: IndexedDB in their own browser, and nowhere else. Nothing here
 * talks to a server.
 *
 * - The database is versioned (`DB_VERSION`), and each record carries its own schema version, which `@dockudos/core`
 *   reads back (`migrateSavedRequest` and friends). A record this version cannot read is left where it is.
 * - When storage is blocked (private browsing with it turned off, a locked-down browser, or no IndexedDB at all) the
 *   same interface keeps everything in memory for the page view and says so, instead of failing.
 * - Values of secret variables never reach IndexedDB unless the reader asks for them to be remembered. They live in
 *   `sessionStorage` (see `client-env.ts`), like the playground's credentials.
 */

export const DB_NAME = 'dockudos-api-client';
export const DB_VERSION = 1;

export type StoreName =
  | 'collections'
  | 'requests'
  | 'environments'
  | 'history'
  | 'examples';
const STORES: StoreName[] = [
  'collections',
  'requests',
  'environments',
  'history',
  'examples',
];

/** Everything a store holds: the model of `@dockudos/core` plus the responses the reader kept. */
export interface StoredData extends ClientData {
  examples: ResponseExample[];
}

export const emptyStoredData = (): StoredData => ({
  ...emptyClientData(),
  examples: [],
});

export interface ClientStorage {
  /** `memory` means nothing written here outlives the page view. */
  readonly kind: 'indexeddb' | 'memory';
  /** Why it is in memory, to show the reader. */
  readonly notice?: string;
  read(): Promise<StoredData>;
  put(store: StoreName, records: unknown[]): Promise<void>;
  remove(store: StoreName, ids: string[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
  close(): void;
}

/** A write that could not be made. `full` is the browser refusing more data. */
export class StorageError extends Error {
  readonly full: boolean;
  constructor(message: string, full: boolean) {
    super(message);
    this.name = 'StorageError';
    this.full = full;
  }
}

const isQuota = (e: unknown): boolean =>
  e instanceof Error &&
  (e.name === 'QuotaExceededError' || /quota|full/i.test(e.message));

const fail = (e: unknown): never => {
  const full = isQuota(e);
  throw new StorageError(
    full
      ? 'This browser has no room left for saved requests. Delete a few, or export them to a file.'
      : `The browser would not save that: ${e instanceof Error ? e.message : String(e)}`,
    full,
  );
};

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('request failed'));
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('transaction failed'));
  });

/** Records of a store, each read by the version that understands it; what cannot be read is skipped. */
const collect = <T>(raw: unknown[], read: (value: unknown) => T | undefined): T[] =>
  raw.map(read).filter((value): value is T => value !== undefined);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('could not open the database'));
    // Another tab is holding the old version open; carry on in memory rather than hanging.
    open.onblocked = () => reject(new Error('another tab is using an older version'));
  });
}

function memoryStorage(notice?: string): ClientStorage {
  const held = new Map<StoreName, Map<string, unknown>>(
    STORES.map((name) => [name, new Map()]),
  );
  return {
    kind: 'memory',
    ...(notice ? { notice } : {}),
    read: async () => shape(held),
    put: async (store, records) => {
      const map = held.get(store) as Map<string, unknown>;
      for (const record of records) {
        map.set((record as { id: string }).id, record);
      }
    },
    remove: async (store, ids) => {
      const map = held.get(store) as Map<string, unknown>;
      for (const id of ids) map.delete(id);
    },
    clear: async (store) => void (held.get(store) as Map<string, unknown>).clear(),
    close: () => undefined,
  };
}

const values = (
  held: Map<StoreName, Map<string, unknown>>,
  name: StoreName,
): unknown[] => [...(held.get(name) as Map<string, unknown>).values()];

const shape = (held: Map<StoreName, Map<string, unknown>>): StoredData => ({
  collections: collect(values(held, 'collections'), migrateCollection),
  requests: collect(values(held, 'requests'), migrateSavedRequest),
  environments: collect(values(held, 'environments'), migrateEnvironment),
  history: collect(values(held, 'history'), migrateHistoryEntry),
  examples: collect(values(held, 'examples'), migrateResponseExample),
});

/** The store for this browser. It never throws on open: a browser without IndexedDB gets the memory one. */
export async function openClientStorage(): Promise<ClientStorage> {
  if (typeof indexedDB === 'undefined') {
    return memoryStorage(
      'This browser has no storage for the client, so saved requests last until the page is closed.',
    );
  }
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch (e) {
    return memoryStorage(
      `Saved requests last until this page is closed: ${e instanceof Error ? e.message : 'storage is blocked'}.`,
    );
  }
  return {
    kind: 'indexeddb',
    read: async () => {
      try {
        const tx = db.transaction(STORES, 'readonly');
        const [collections, requests, environments, history, examples] =
          await Promise.all(
            STORES.map((name) => promised(tx.objectStore(name).getAll())),
          );
        return {
          collections: collect(collections ?? [], migrateCollection),
          requests: collect(requests ?? [], migrateSavedRequest),
          environments: collect(environments ?? [], migrateEnvironment),
          history: collect(history ?? [], migrateHistoryEntry),
          examples: collect(examples ?? [], migrateResponseExample),
        };
      } catch {
        // A damaged database should not take the page with it.
        return emptyStoredData();
      }
    },
    put: async (store, records) => {
      if (!records.length) return;
      try {
        const tx = db.transaction(store, 'readwrite');
        for (const record of records) tx.objectStore(store).put(record);
        await finished(tx);
      } catch (e) {
        fail(e);
      }
    },
    remove: async (store, ids) => {
      if (!ids.length) return;
      try {
        const tx = db.transaction(store, 'readwrite');
        for (const id of ids) tx.objectStore(store).delete(id);
        await finished(tx);
      } catch (e) {
        fail(e);
      }
    },
    clear: async (store) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        await finished(tx);
      } catch (e) {
        fail(e);
      }
    },
    close: () => db.close(),
  };
}

/** History is capped: the newest entries are kept and the rest are dropped. */
export const cappedHistory = (entries: HistoryEntry[]): HistoryEntry[] =>
  [...entries].sort((a, b) => b.at - a.at).slice(0, CLIENT_LIMITS.history);

export type {
  ClientData,
  Collection,
  Environment,
  HistoryEntry,
  ResponseExample,
  SavedRequest,
};

/** An environment as it is written to IndexedDB: a secret value is left out unless the reader remembers it. */
export const withoutSecrets = (
  environment: Environment,
  remember: boolean,
): Environment =>
  remember
    ? environment
    : {
        ...environment,
        variables: environment.variables.map((v) =>
          v.secret ? { ...v, value: '' } : v,
        ),
      };
