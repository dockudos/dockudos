import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  DB_NAME,
  DB_VERSION,
  StorageError,
  cappedHistory,
  emptyStoredData,
  openClientStorage,
  withoutSecrets,
} from './client-db.ts';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  collectionId: 'c1',
  name: 'List pets',
  order: 1,
  createdAt: 10,
  updatedAt: 10,
  request: { method: 'GET', url: 'https://api.test/pets', headers: [] },
  v: 1,
  ...over,
});

beforeEach(() => {
  // A database of its own for each test.
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the store in the browser', () => {
  it('keeps records, reads them back, and removes them again', async () => {
    const storage = await openClientStorage();
    expect(storage.kind).toBe('indexeddb');
    await storage.put('collections', [
      { id: 'c1', name: 'Petstore', order: 1, createdAt: 1, v: 1 },
    ]);
    await storage.put('requests', [record(), record({ id: 'r2', name: 'Add a pet' })]);
    await storage.put('environments', [
      { id: 'e1', name: 'Sandbox', order: 1, variables: [{ name: 'a', value: '1' }], v: 1 },
    ]);
    await storage.put('history', [
      { id: 'h1', at: 5, method: 'GET', url: 'https://api.test/pets', status: 200 },
    ]);
    await storage.put('examples', [
      { id: 'x1', requestId: 'r1', name: '200', at: 5, status: 200, headers: [], body: '{}', v: 1 },
    ]);

    const data = await storage.read();
    expect(data.collections.map((c) => c.name)).toEqual(['Petstore']);
    expect(data.requests.map((r) => r.name)).toEqual(['List pets', 'Add a pet']);
    expect(data.environments[0]?.variables).toEqual([{ name: 'a', value: '1' }]);
    expect(data.history[0]?.status).toBe(200);
    expect(data.examples[0]?.body).toBe('{}');

    await storage.remove('requests', ['r2']);
    expect((await storage.read()).requests.map((r) => r.id)).toEqual(['r1']);
    await storage.clear('history');
    expect((await storage.read()).history).toEqual([]);
    storage.close();
  });

  it('survives the page being reloaded', async () => {
    const first = await openClientStorage();
    await first.put('requests', [record()]);
    first.close();
    const second = await openClientStorage();
    expect((await second.read()).requests).toHaveLength(1);
    second.close();
  });

  it('does nothing when asked to write or remove nothing', async () => {
    const storage = await openClientStorage();
    await expect(storage.put('requests', [])).resolves.toBeUndefined();
    await expect(storage.remove('requests', [])).resolves.toBeUndefined();
    storage.close();
  });

  it('fills in a record an older version wrote and leaves a newer one alone', async () => {
    const storage = await openClientStorage();
    await storage.put('requests', [
      // No name, order or updatedAt: fields this version adds.
      { id: 'old', collectionId: 'c1', request: { url: 'https://api.test/pets' } },
      // From a version that is not out yet; this one must not rewrite it.
      { id: 'future', collectionId: 'c1', request: { url: 'https://api.test/x' }, v: 99 },
      { id: 'broken', collectionId: 'c1' },
    ]);
    const data = await storage.read();
    expect(data.requests.map((r) => r.id)).toEqual(['old']);
    expect(data.requests[0]).toMatchObject({ name: 'GET /pets', v: 1, order: expect.any(Number) });
    storage.close();
  });

  it('says the browser is full when it refuses a write', async () => {
    const storage = await openClientStorage();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      const error = new Error('no room');
      error.name = 'QuotaExceededError';
      throw error;
    });
    const refused = await storage.put('requests', [record()]).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StorageError);
    expect((refused as StorageError).full).toBe(true);
    expect((refused as StorageError).message).toMatch(/no room left/);
    storage.close();
  });

  it('passes on any other refusal as it is', async () => {
    const storage = await openClientStorage();
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new Error('gone wrong');
    });
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => {
      throw new Error('gone wrong');
    });
    await expect(storage.remove('requests', ['r1'])).rejects.toThrow(/gone wrong/);
    const refused = await storage.clear('history').catch((e: unknown) => e);
    expect((refused as StorageError).full).toBe(false);
    storage.close();
  });

  it('gives back nothing rather than failing when a read goes wrong', async () => {
    const storage = await openClientStorage();
    await storage.put('requests', [record()]);
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new Error('damaged');
    });
    expect(await storage.read()).toEqual(emptyStoredData());
    storage.close();
  });
});

describe('when there is no store to use', () => {
  it('keeps everything in memory, and says so, where there is no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const storage = await openClientStorage();
    expect(storage.kind).toBe('memory');
    expect(storage.notice).toMatch(/until the page is closed/);
    await storage.put('requests', [record(), record({ id: 'r2' })]);
    await storage.put('collections', [{ id: 'c1', name: 'C', order: 1, createdAt: 1, v: 1 }]);
    expect((await storage.read()).requests).toHaveLength(2);
    await storage.remove('requests', ['r2']);
    expect((await storage.read()).requests).toHaveLength(1);
    await storage.clear('requests');
    expect((await storage.read()).requests).toEqual([]);
    expect(() => storage.close()).not.toThrow();
  });

  it('keeps everything in memory when opening the database is blocked', async () => {
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
      const request = { onerror: null } as unknown as IDBOpenDBRequest & {
        onerror: ((e: unknown) => void) | null;
      };
      setTimeout(() => request.onerror?.(new Event('error')), 0);
      return request as IDBOpenDBRequest;
    });
    const storage = await openClientStorage();
    expect(storage.kind).toBe('memory');
    expect(storage.notice).toMatch(/lasts? until this page is closed/);
  });

  it('uses the name and version it says it does', () => {
    expect(DB_NAME).toBe('dockudos-api-client');
    expect(DB_VERSION).toBe(1);
  });
});

describe('the small rules around the store', () => {
  it('keeps the newest entries of the history and drops the rest', () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({
      id: `h${i}`,
      at: i,
      method: 'GET',
      url: `https://api.test/${i}`,
    }));
    const kept = cappedHistory(entries);
    expect(kept).toHaveLength(100);
    expect(kept[0]?.id).toBe('h119');
  });

  it('leaves a secret value out of what is stored unless it is remembered', () => {
    const environment = {
      id: 'e1',
      name: 'Sandbox',
      order: 1,
      variables: [
        { name: 'baseUrl', value: 'https://api.test' },
        { name: 'token', value: 'sk-live-1', secret: true },
      ],
      v: 1,
    };
    expect(withoutSecrets(environment, false).variables[1]).toEqual({
      name: 'token',
      value: '',
      secret: true,
    });
    expect(withoutSecrets(environment, true)).toBe(environment);
  });
});
