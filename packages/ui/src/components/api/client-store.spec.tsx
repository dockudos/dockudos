import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { importText } from '@dockudos/core';
import { act, renderHook, waitFor } from '@testing-library/react';

/** A store that has read nothing yet, with its own database. */
const fresh = async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const store = await import('./client-store.ts');
  await store.loadClient();
  return store;
};

/** The same store again, as a second visit to the page would see it. */
const reopened = async (previous?: { whenWritten: () => Promise<void> }) => {
  await previous?.whenWritten();
  vi.resetModules();
  const store = await import('./client-store.ts');
  await store.loadClient();
  return store;
};

const names = (items: { name: string; order: number }[]) =>
  [...items].sort((a, b) => a.order - b.order).map((i) => i.name);

const request = (over: Record<string, unknown> = {}) => ({
  method: 'GET',
  url: 'https://api.test/pets',
  headers: [] as [string, string][],
  ...over,
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading the store', () => {
  it('starts empty and says where it is keeping things', async () => {
    const store = await fresh();
    expect(store.clientSnapshot()).toMatchObject({
      loaded: true,
      where: 'indexeddb',
      collections: [],
      requests: [],
      rememberSecrets: false,
      historyWithSecrets: false,
    });
  });

  it('opens the store once, however many components ask for it', async () => {
    const store = await fresh();
    const { result } = renderHook(() => store.useApiClient());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => void store.addCollection('Petstore'));
    expect(result.current.collections.map((c) => c.name)).toEqual(['Petstore']);
  });

  it('says so when the browser keeps nothing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const store = await import('./client-store.ts');
    await store.loadClient();
    expect(store.clientSnapshot().where).toBe('memory');
    expect(store.clientSnapshot().notice).toMatch(/until the page is closed/);
  });
});

describe('collections', () => {
  it('adds, renames, reorders and deletes, taking the requests with it', async () => {
    const store = await fresh();
    const first = store.addCollection('  Petstore  ');
    const second = store.addCollection('Admin');
    expect(first.name).toBe('Petstore');
    store.saveRequest({ collectionId: first.id, name: 'List pets', request: request() });
    store.saveRequest({ collectionId: second.id, name: 'Users', request: request() });

    store.renameCollection(first.id, 'Pets');
    expect(store.clientSnapshot().collections.find((c) => c.id === first.id)?.name).toBe('Pets');
    store.renameCollection(first.id, '   ');
    expect(store.clientSnapshot().collections.find((c) => c.id === first.id)?.name).toBe('Pets');
    store.renameCollection('gone', 'nothing');

    store.moveCollection(second.id, 0);
    expect(
      [...store.clientSnapshot().collections]
        .sort((a, b) => a.order - b.order)
        .map((c) => c.name),
    ).toEqual(['Admin', 'Pets']);

    store.deleteCollection(first.id);
    expect(store.clientSnapshot().collections.map((c) => c.name)).toEqual(['Admin']);
    expect(store.clientSnapshot().requests.map((r) => r.name)).toEqual(['Users']);

    const again = await reopened(store);
    expect(names(again.clientSnapshot().collections)).toEqual(['Admin']);
    expect(names(again.clientSnapshot().requests)).toEqual(['Users']);
  });

  it('refuses more collections than a reader should keep, and says why', async () => {
    const store = await fresh();
    for (let i = 0; i < 100; i += 1) store.addCollection(`C${i}`);
    store.addCollection('one too many');
    expect(store.clientSnapshot().collections).toHaveLength(100);
    expect(store.clientSnapshot().notice).toMatch(/may keep 100 collections/);
    store.clearNotice();
    expect(store.clientSnapshot().notice).toBeUndefined();
  });
});

describe('saving a request', () => {
  it('puts it in the first collection when none is chosen, making one if there is none', async () => {
    const store = await fresh();
    const saved = store.saveRequest({ request: request() });
    expect(store.clientSnapshot().collections.map((c) => c.name)).toEqual(['My requests']);
    expect(saved.name).toBe('GET /pets');
    expect(saved.collectionId).toBe(store.clientSnapshot().collections[0]?.id);
  });

  it('never stores a credential, and says what it left out', async () => {
    const store = await fresh();
    const saved = store.saveRequest({
      name: 'With a key',
      request: request({
        headers: [
          ['api_key', 'sk-live-1'],
          ['Accept', 'application/json'],
        ],
      }),
      secrets: ['sk-live-1'],
      authFields: ['api_key'],
    });
    expect(saved.request.headers).toEqual([
      ['api_key', ''],
      ['Accept', 'application/json'],
    ]);
    expect(saved.redacted).toEqual(['api_key']);
    expect(JSON.stringify(store.clientSnapshot().requests)).not.toContain('sk-live-1');
  });

  it('turns a value the chosen environment holds as a secret into its name', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    store.setVariables(environment.id, [{ name: 'token', value: 'sk-live-1', secret: true }]);
    const saved = store.saveRequest({
      request: request({ headers: [['Authorization', 'Bearer sk-live-1']] }),
      secrets: ['sk-live-1'],
      authFields: ['authorization'],
    });
    expect(saved.request.headers).toEqual([['Authorization', 'Bearer {{token}}']]);
    expect(saved.redacted).toBeUndefined();
  });

  it('keeps where it came from, so an endpoint page can fill its form in again', async () => {
    const store = await fresh();
    const origin = {
      operationId: 'getPetById',
      href: '/api-reference/pet/getpetbyid',
      base: 'https://api.test',
      values: { path: { petId: '1' }, query: {}, header: {}, cookie: {} },
    };
    expect(store.saveRequest({ request: request(), origin }).origin).toEqual(origin);
  });

  it('renames, moves and deletes a saved request', async () => {
    const store = await fresh();
    const collection = store.addCollection('Petstore');
    const first = store.saveRequest({ collectionId: collection.id, name: 'First', request: request() });
    const second = store.saveRequest({ collectionId: collection.id, name: 'Second', request: request() });
    store.saveRequest({ collectionId: store.addCollection('Other').id, name: 'Elsewhere', request: request() });

    store.updateRequest(first.id, { name: '  Renamed  ' });
    expect(store.clientSnapshot().requests.find((r) => r.id === first.id)?.name).toBe('Renamed');
    store.updateRequest(first.id, { name: '   ' });
    expect(store.clientSnapshot().requests.find((r) => r.id === first.id)?.name).toBe('Renamed');
    store.updateRequest('gone', { name: 'nothing' });

    store.moveRequest(second.id, 0);
    expect(
      names(store.clientSnapshot().requests.filter((r) => r.collectionId === collection.id)),
    ).toEqual(['Second', 'Renamed']);
    store.moveRequest('gone', 0);

    store.deleteRequest(second.id);
    expect(store.clientSnapshot().requests.map((r) => r.name).sort()).toEqual([
      'Elsewhere',
      'Renamed',
    ]);
  });

  it('refuses more requests in one collection than it should hold', async () => {
    const store = await fresh();
    const collection = store.addCollection('Big');
    for (let i = 0; i < 500; i += 1) {
      store.saveRequest({ collectionId: collection.id, name: `r${i}`, request: request() });
    }
    store.saveRequest({ collectionId: collection.id, name: 'one too many', request: request() });
    expect(store.clientSnapshot().requests).toHaveLength(500);
    expect(store.clientSnapshot().notice).toMatch(/may hold 500 requests/);
  });
});

describe('environments', () => {
  it('becomes the chosen one, mirrors itself for endpoint pages, and keeps secrets in the tab', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    expect(store.clientSnapshot().activeEnvironmentId).toBe(environment.id);
    store.setVariables(environment.id, [
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: 'sk-live-1', secret: true },
    ]);

    // The mirror endpoint pages read has the variables but not the secret value.
    const mirror = localStorage.getItem('dockudos-api-client-env') as string;
    expect(mirror).toContain('baseUrl');
    expect(mirror).not.toContain('sk-live-1');
    // The tab holds the value, as the playground holds credentials.
    expect(sessionStorage.getItem('dockudos-api-client-secrets')).toContain('sk-live-1');
    expect(store.activeVariables()).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: 'sk-live-1', secret: true },
    ]);

    // A new tab has the environment but not the secret.
    sessionStorage.clear();
    const again = await reopened(store);
    const read = again.clientSnapshot().environments[0];
    expect(read?.variables).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: '', secret: true },
    ]);
  });

  it('remembers secret values when the reader asks, and forgets them again', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    store.setRememberSecrets(true);
    store.setVariables(environment.id, [{ name: 'token', value: 'sk-live-1', secret: true }]);
    sessionStorage.clear();
    let again = await reopened(store);
    expect(again.clientSnapshot().environments[0]?.variables[0]?.value).toBe('sk-live-1');

    again.setRememberSecrets(false);
    sessionStorage.clear();
    again = await reopened(again);
    expect(again.clientSnapshot().environments[0]?.variables[0]?.value).toBe('');
    expect(again.clientSnapshot().rememberSecrets).toBe(false);
  });

  it('renames, picks and deletes, choosing another one when the chosen one goes', async () => {
    const store = await fresh();
    const first = store.addEnvironment('Sandbox');
    const second = store.addEnvironment('Live');
    store.renameEnvironment(first.id, 'Test');
    expect(store.clientSnapshot().environments.map((e) => e.name)).toEqual(['Test', 'Live']);
    store.renameEnvironment('gone', 'nothing');

    store.chooseEnvironment(first.id);
    expect(store.clientSnapshot().activeEnvironmentId).toBe(first.id);
    store.chooseEnvironment(undefined);
    expect(store.activeVariables()).toEqual([]);

    store.chooseEnvironment(second.id);
    store.deleteEnvironment(second.id);
    expect(store.clientSnapshot().environments.map((e) => e.name)).toEqual(['Test']);
    expect(store.clientSnapshot().activeEnvironmentId).toBe(first.id);
    store.deleteEnvironment(first.id);
    expect(store.clientSnapshot().activeEnvironmentId).toBeUndefined();
  });

  it('changes one variable at a time, so two quick edits cannot undo each other', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    store.addVariable(environment.id);
    const variables = () =>
      store.clientSnapshot().environments.find((e) => e.id === environment.id)?.variables;

    store.updateVariable(environment.id, 0, { name: 'token' });
    store.updateVariable(environment.id, 0, { value: 'sk-live-1' });
    store.updateVariable(environment.id, 0, { secret: true });
    expect(variables()).toEqual([{ name: 'token', value: 'sk-live-1', secret: true }]);

    // The mirror endpoint pages read never holds the value of a secret variable.
    expect(localStorage.getItem('dockudos-api-client-env')).not.toContain('sk-live-1');
    expect(sessionStorage.getItem('dockudos-api-client-secrets')).toContain('sk-live-1');

    // Unticking "secret" puts the value back in the records and takes it out of the tab.
    store.updateVariable(environment.id, 0, { secret: false });
    expect(sessionStorage.getItem('dockudos-api-client-secrets')).not.toContain('sk-live-1');
    expect(localStorage.getItem('dockudos-api-client-env')).toContain('sk-live-1');

    store.addVariable(environment.id);
    store.updateVariable(environment.id, 1, { name: 'baseUrl' });
    expect(variables()?.map((v) => v.name)).toEqual(['token', 'baseUrl']);
    store.removeVariable(environment.id, 0);
    expect(variables()).toEqual([{ name: 'baseUrl', value: '' }]);

    // Nothing happens to an environment that is not there.
    store.updateVariable('gone', 0, { name: 'x' });
    store.addVariable('gone');
    store.removeVariable('gone', 0);
  });

  it('stops adding variables at the limit', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    for (let i = 0; i < 205; i += 1) store.addVariable(environment.id);
    expect(
      store.clientSnapshot().environments.find((e) => e.id === environment.id)?.variables,
    ).toHaveLength(200);
  });

  it('refuses more environments than it should hold', async () => {
    const store = await fresh();
    for (let i = 0; i < 50; i += 1) store.addEnvironment(`E${i}`);
    store.addEnvironment('one too many');
    expect(store.clientSnapshot().environments).toHaveLength(50);
    expect(store.clientSnapshot().notice).toMatch(/may keep 50 environments/);
  });
});

describe('history', () => {
  it('notes what was sent, newest first, and clears on request', async () => {
    const store = await fresh();
    store.recordSent({ request: request(), status: 200, ms: 12.6 });
    store.recordSent({ request: request({ method: 'POST' }), error: 'The request could not be sent.' });
    const history = store.clientSnapshot().history;
    expect(history[0]).toMatchObject({ method: 'POST', error: 'The request could not be sent.' });
    expect(history[1]).toMatchObject({ status: 200, ms: 13 });

    const again = await reopened(store);
    expect(again.clientSnapshot().history).toHaveLength(2);
    again.clearHistory();
    expect(again.clientSnapshot().history).toEqual([]);
    expect((await reopened(again)).clientSnapshot().history).toEqual([]);
  });

  it('leaves out a request that used a secret variable, unless the reader turns that on', async () => {
    const store = await fresh();
    const environment = store.addEnvironment('Sandbox');
    store.setVariables(environment.id, [
      { name: 'token', value: 'sk-live-1', secret: true },
      { name: 'baseUrl', value: 'https://api.test' },
    ]);
    const withSecret = request({
      url: '{{baseUrl}}/pets',
      headers: [['Authorization', 'Bearer {{token}}']],
    });
    expect(store.recordSent({ request: withSecret, status: 200 })).toBeUndefined();
    expect(store.clientSnapshot().history).toEqual([]);

    // A request that uses only ordinary variables is listed, as written.
    store.recordSent({ request: request({ url: '{{baseUrl}}/pets' }), status: 200 });
    expect(store.clientSnapshot().history[0]?.url).toBe('{{baseUrl}}/pets');

    store.setHistoryWithSecrets(true);
    store.recordSent({ request: withSecret, status: 201 });
    expect(store.clientSnapshot().history[0]).toMatchObject({ status: 201 });
    expect(JSON.stringify(store.clientSnapshot().history)).not.toContain('sk-live-1');
    expect((await reopened(store)).clientSnapshot().historyWithSecrets).toBe(true);
  });

  it('keeps the newest hundred', async () => {
    const store = await fresh();
    for (let i = 0; i < 105; i += 1) {
      store.recordSent({ request: request({ url: `https://api.test/${i}` }), status: 200 });
    }
    const history = store.clientSnapshot().history;
    expect(history).toHaveLength(100);
    expect(history[0]?.url).toBe('https://api.test/104');
    expect((await reopened(store)).clientSnapshot().history).toHaveLength(100);
  });
});

describe('responses the reader kept', () => {
  it('keeps them with their request and drops the oldest past the limit', async () => {
    const store = await fresh();
    const saved = store.saveRequest({ request: request() });
    for (let i = 0; i < 12; i += 1) {
      store.keepExample({ requestId: saved.id, name: `run ${i}`, status: 200, body: `{"n":${i}}` });
    }
    const kept = store.clientSnapshot().examples;
    expect(kept).toHaveLength(10);
    expect(kept.map((e) => e.name)).toContain('run 11');
    expect(kept.map((e) => e.name)).not.toContain('run 0');

    const first = kept[0];
    store.deleteExample(first?.id as string);
    expect(store.clientSnapshot().examples).toHaveLength(9);

    // Deleting the request takes its kept responses with it.
    store.deleteRequest(saved.id);
    expect(store.clientSnapshot().examples).toEqual([]);
    expect((await reopened(store)).clientSnapshot().examples).toEqual([]);
  });

  it('keeps one that belongs to no saved request', async () => {
    const store = await fresh();
    expect(store.keepExample({ name: '200', status: 200, body: '{}' }).requestId).toBeUndefined();
    expect(store.clientSnapshot().examples).toHaveLength(1);
  });
});

describe('importing', () => {
  it('adds what was read and gives a collection whose name is taken a number', async () => {
    const store = await fresh();
    store.addCollection('Imported');
    store.addImported(importText('curl https://api.test/pets'));
    store.addImported(importText('curl https://api.test/pets/1'));
    expect(names(store.clientSnapshot().collections)).toEqual([
      'Imported',
      'Imported (2)',
      'Imported (3)',
    ]);
    expect(store.clientSnapshot().requests.map((r) => r.name)).toEqual([
      'GET /pets',
      'GET /pets/1',
    ]);
    expect((await reopened(store)).clientSnapshot().requests).toHaveLength(2);
  });

  it('brings an environment from a Postman collection with it', async () => {
    const store = await fresh();
    store.addImported(
      importText(
        JSON.stringify({
          info: { name: 'Petstore', schema: 'v2.1' },
          item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/pets' } }],
          variable: [{ key: 'baseUrl', value: 'https://api.test' }],
        }),
      ),
    );
    expect(store.clientSnapshot().environments[0]?.variables).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
    ]);
  });
});

describe('when a write is refused', () => {
  it('keeps what is on screen and tells the reader', async () => {
    const store = await fresh();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      const error = new Error('no room');
      error.name = 'QuotaExceededError';
      throw error;
    });
    const collection = store.addCollection('Petstore');
    await waitFor(() => expect(store.clientSnapshot().notice).toMatch(/no room left/));
    expect(store.clientSnapshot().collections.map((c) => c.id)).toEqual([collection.id]);
  });

  it('starts again from nothing when asked to', async () => {
    const store = await fresh();
    store.addCollection('Petstore');
    store.resetClientStore();
    expect(store.clientSnapshot()).toMatchObject({ loaded: false, collections: [] });
  });
});
