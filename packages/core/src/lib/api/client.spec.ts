import {
  CLIENT_LIMITS,
  CLIENT_SCHEMA_VERSION,
  type StoredRequest,
  authFieldNames,
  emptyClientData,
  lastOrder,
  maskSecret,
  migrateCollection,
  migrateEnvironment,
  migrateHistoryEntry,
  migrateSavedRequest,
  newId,
  readRequest,
  readVariables,
  redactRequest,
  reorder,
  suggestedName,
} from './client.ts';

const request = (over: Partial<StoredRequest> = {}): StoredRequest => ({
  method: 'GET',
  url: 'https://api.test/pets',
  headers: [],
  ...over,
});

describe('ids and names', () => {
  it('uses the browser id generator when there is one, and still gives an id when there is not', () => {
    expect(newId()).not.toEqual(newId());
    const real = globalThis.crypto;
    // A browser old enough to miss randomUUID still has IndexedDB, so this path has to work.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      expect(newId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });

  it('names a request after its method and path, and copes with a half-typed URL', () => {
    expect(suggestedName(request())).toBe('GET /pets');
    expect(suggestedName(request({ method: 'post', url: 'api.test/pets' }))).toBe(
      'POST api.test/pets',
    );
    expect(suggestedName(request({ url: '' }))).toBe('GET');
  });

  it('starts empty', () => {
    expect(emptyClientData()).toEqual({
      collections: [],
      requests: [],
      environments: [],
      history: [],
    });
  });
});

describe('taking credentials out', () => {
  it('empties an Authorization header and names it', () => {
    const { request: out, redacted } = redactRequest(
      request({ headers: [['Authorization', 'Bearer sk-live-1']] }),
      { authFields: authFieldNames({}) },
    );
    expect(out.headers).toEqual([['Authorization', '']]);
    expect(redacted).toEqual(['Authorization']);
  });

  it('keeps an authentication header whose value is a variable reference', () => {
    const { request: out, redacted } = redactRequest(
      request({ headers: [['Authorization', 'Bearer {{token}}']] }),
      { authFields: ['authorization'] },
    );
    expect(out.headers).toEqual([['Authorization', 'Bearer {{token}}']]);
    expect(redacted).toEqual([]);
  });

  it('turns the value of a secret variable into its name, wherever it is', () => {
    const { request: out, redacted } = redactRequest(
      request({
        method: 'POST',
        url: 'https://api.test/pets?trace=sk-live-1',
        headers: [
          ['Authorization', 'Bearer sk-live-1'],
          ['X-Trace', 'sk-live-1'],
        ],
        body: { contentType: 'application/json', text: '{"key":"sk-live-1"}' },
      }),
      {
        variables: [{ name: 'token', value: 'sk-live-1', secret: true }],
        authFields: ['authorization'],
      },
    );
    expect(out.headers).toEqual([
      ['Authorization', 'Bearer {{token}}'],
      ['X-Trace', '{{token}}'],
    ]);
    expect(out.url).toBe('https://api.test/pets?trace={{token}}');
    expect(out.body?.text).toBe('{"key":"{{token}}"}');
    expect(redacted).toEqual([]);
  });

  it('empties an API key named by a security scheme, in a header and in the query', () => {
    const fields = authFieldNames({
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'api_key' },
      apiKeyQuery: { type: 'apiKey', in: 'query', name: 'key' },
      bearer: { type: 'http' },
    });
    expect(fields).toEqual(['authorization', 'api_key', 'key']);
    const { request: out, redacted } = redactRequest(
      request({
        url: 'https://api.test/pets?key=secret-value&status=sold',
        headers: [
          ['api_key', 'secret-value'],
          ['accept', 'application/json'],
        ],
      }),
      { authFields: fields },
    );
    expect(out.url).toBe('https://api.test/pets?key=&status=sold');
    expect(out.headers).toEqual([
      ['api_key', ''],
      ['accept', 'application/json'],
    ]);
    expect(redacted).toEqual(['api_key', 'key']);
  });

  it('keeps a query key that is a variable reference and leaves a URL without a query alone', () => {
    const fields = ['key'];
    expect(
      redactRequest(request({ url: 'https://api.test/pets?key={{apiKey}}&a=1' }), {
        authFields: fields,
      }).request.url,
    ).toBe('https://api.test/pets?key=%7B%7BapiKey%7D%7D&a=1');
    expect(
      redactRequest(request({ url: 'https://api.test/pets?flag' }), {
        authFields: fields,
      }).request.url,
    ).toBe('https://api.test/pets?flag');
    expect(redactRequest(request()).request.url).toBe('https://api.test/pets');
  });

  it('removes a credential that is not a variable from anywhere it appears, and names where it was', () => {
    const { request: out, redacted } = redactRequest(
      request({
        url: 'https://api.test/pets?t=abc123',
        headers: [['X-Custom', 'prefix-abc123']],
        body: { contentType: 'text/plain', text: 'abc123 in the body' },
      }),
      { secrets: ['abc123', ''] },
    );
    expect(out.headers).toEqual([['X-Custom', 'prefix-']]);
    expect(out.body?.text).toBe(' in the body');
    expect(out.url).toBe('https://api.test/pets?t=');
    expect(redacted).toEqual(['X-Custom', 'url', 'body']);
  });

  it('treats Cookie as a credential and cuts a body at the limit', () => {
    const long = 'x'.repeat(CLIENT_LIMITS.bodyLength + 10);
    const { request: out, redacted } = redactRequest(
      request({
        headers: [['Cookie', 'session=1']],
        body: { contentType: 'text/plain', text: long },
      }),
    );
    expect(out.headers).toEqual([['Cookie', '']]);
    expect(out.body?.text).toHaveLength(CLIENT_LIMITS.bodyLength);
    expect(redacted).toEqual(['Cookie']);
  });

  it('masks a secret so two can be told apart but neither can be used', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('short')).toBe('•••••');
    expect(maskSecret('sk-live-abcdef')).toBe('sk-l••••••ef');
  });
});

describe('reading records back', () => {
  it('fills in what an older record did not write', () => {
    const saved = migrateSavedRequest({
      id: 'r1',
      collectionId: 'c1',
      createdAt: 1000,
      request: { url: 'https://api.test/pets' },
    });
    expect(saved).toMatchObject({
      id: 'r1',
      name: 'GET /pets',
      order: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      v: CLIENT_SCHEMA_VERSION,
      request: { method: 'GET', url: 'https://api.test/pets', headers: [] },
    });
  });

  it('leaves a record written by a newer version alone', () => {
    expect(migrateSavedRequest({ v: 99, request: { url: 'x' } })).toBeUndefined();
    expect(migrateCollection({ v: 99 })).toBeUndefined();
    expect(migrateEnvironment({ v: 99 })).toBeUndefined();
  });

  it('refuses anything that is not a record', () => {
    for (const value of [null, 'text', 42, []]) {
      expect(migrateSavedRequest(value)).toBeUndefined();
      expect(migrateCollection(value)).toBeUndefined();
      expect(migrateEnvironment(value)).toBeUndefined();
      expect(migrateHistoryEntry(value)).toBeUndefined();
      expect(readRequest(value)).toBeUndefined();
    }
    expect(migrateSavedRequest({ request: { method: 'GET' } })).toBeUndefined();
  });

  it('keeps where a request came from, and drops an origin without an operation', () => {
    const origin = {
      operationId: 'getPet',
      href: '/api-reference/pet/getpet',
      base: 'https://api.test',
      values: { path: { petId: '1' }, query: {}, header: {}, cookie: {} },
    };
    expect(
      migrateSavedRequest({ request: { url: 'https://api.test/pet/1' }, origin })?.origin,
    ).toEqual(origin);
    expect(
      migrateSavedRequest({
        request: { url: 'https://api.test/pet/1' },
        origin: { operationId: 'getPet' },
      })?.origin,
    ).toEqual({
      operationId: 'getPet',
      base: '',
      values: { path: {}, query: {}, header: {}, cookie: {} },
    });
    expect(
      migrateSavedRequest({ request: { url: 'https://api.test/pet/1' }, origin: { base: 'x' } })
        ?.origin,
    ).toBeUndefined();
  });

  it('keeps the names of what was redacted, and gives an id and a name when there are none', () => {
    const saved = migrateSavedRequest({
      request: { url: 'https://api.test/pets', method: 'post' },
      redacted: ['Authorization', 7],
      name: '   ',
    });
    expect(saved?.redacted).toEqual(['Authorization']);
    expect(saved?.id).toBeTruthy();
    expect(saved?.name).toBe('POST /pets');
  });

  it('drops headers and bodies it cannot read, and cuts long names', () => {
    const read = readRequest({
      url: 'https://api.test/pets',
      headers: [['a', 'b'], ['c'], 'nope', [7, 'x']],
      body: { text: '' },
    });
    expect(read).toEqual({
      method: 'GET',
      url: 'https://api.test/pets',
      headers: [
        ['a', 'b'],
        ['c', ''],
      ],
      body: undefined,
    });
    expect(readRequest({ url: 'x', body: 'text' })?.body).toBeUndefined();
    expect(
      migrateSavedRequest({
        request: { url: 'https://api.test/pets' },
        name: 'n'.repeat(500),
      })?.name,
    ).toHaveLength(CLIENT_LIMITS.nameLength);
  });

  it('reads a body with its content type, defaulting to JSON', () => {
    expect(readRequest({ url: 'x', body: { text: '{}' } })?.body).toEqual({
      contentType: 'application/json',
      text: '{}',
    });
    expect(
      readRequest({ url: 'x', body: { contentType: 'text/plain', text: 'hi' } })?.body,
    ).toEqual({ contentType: 'text/plain', text: 'hi' });
  });

  it('reads a collection and an environment', () => {
    expect(migrateCollection({ name: ' My  API ', createdAt: 5 })).toEqual({
      id: expect.any(String),
      name: 'My API',
      order: 5,
      createdAt: 5,
      v: CLIENT_SCHEMA_VERSION,
    });
    expect(migrateCollection({})?.name).toBe('Collection');
    expect(migrateEnvironment({ variables: 'nope' })).toMatchObject({
      name: 'Environment',
      order: 0,
      variables: [],
    });
  });

  it('keeps each variable once, drops nameless ones, and stops at the limit', () => {
    expect(
      readVariables([
        { name: 'baseUrl', value: 'https://api.test' },
        { name: 'baseUrl', value: 'second' },
        { name: ' ', value: 'x' },
        { name: 'token', value: 't', secret: true },
        'nope',
      ]),
    ).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: 't', secret: true },
    ]);
    expect(readVariables('nope')).toEqual([]);
    const many = Array.from({ length: CLIENT_LIMITS.variablesPerEnvironment + 5 }, (_, i) => ({
      name: `v${i}`,
      value: '1',
    }));
    expect(readVariables(many)).toHaveLength(CLIENT_LIMITS.variablesPerEnvironment);
  });

  it('reads a history entry and keeps only the fields it knows', () => {
    expect(
      migrateHistoryEntry({
        id: 'h1',
        at: 10,
        method: 'post',
        url: 'https://api.test/pets',
        status: 201,
        ms: 12,
        error: 'none',
        requestId: 'r1',
        extra: 'dropped',
      }),
    ).toEqual({
      id: 'h1',
      at: 10,
      method: 'POST',
      url: 'https://api.test/pets',
      status: 201,
      ms: 12,
      error: 'none',
      requestId: 'r1',
    });
    expect(migrateHistoryEntry({ url: 'x' })).toMatchObject({ method: 'GET', url: 'x' });
    expect(migrateHistoryEntry({ at: 1 })).toBeUndefined();
  });
});

describe('ordering', () => {
  it('puts a new item last', () => {
    expect(lastOrder([])).toBe(1);
    expect(lastOrder([{ order: 3 }, { order: 1 }])).toBe(4);
  });

  it('moves an item and renumbers from one', () => {
    const items = [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
      { id: 'c', order: 3 },
    ];
    expect(reorder(items, 'c', 0).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(reorder(items, 'a', 99).map((i) => [i.id, i.order])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
    expect(reorder(items, 'a', -2).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(reorder(items, 'gone', 0).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
