import { normalizeOpenApi, openApiVersion } from './openapi.ts';
import { ApiSpecError } from './types.ts';

const info = { title: 'T', version: '1' };
const ok = { '200': { description: 'ok' } };
const make = (doc: Record<string, unknown>) =>
  normalizeOpenApi({ openapi: '3.1.0', info, paths: {}, ...doc }, 'spec.json');

describe('openApiVersion', () => {
  it('tells the supported versions apart', () => {
    expect(openApiVersion({ openapi: '3.0.3' })).toBe('3.0');
    expect(openApiVersion({ openapi: '3.1.0' })).toBe('3.1');
    expect(openApiVersion({ openapi: '4.0.0' })).toBeUndefined();
    expect(openApiVersion({ swagger: '2.0' })).toBe('2.0');
    expect(openApiVersion({ swagger: '1.2' })).toBeUndefined();
    expect(openApiVersion('x')).toBeUndefined();
    expect(openApiVersion(null)).toBeUndefined();
  });
});

describe('normalizeOpenApi: refusals', () => {
  it('names what is wrong with the document', () => {
    expect(() => normalizeOpenApi({ swagger: '2.0' }, 's')).toThrow(
      ApiSpecError,
    );
    expect(() => normalizeOpenApi({ openapi: '3.0.0' }, 's')).toThrow(
      'info.title',
    );
    expect(() => normalizeOpenApi({ openapi: '3.0.0', info }, 's')).toThrow(
      'has no "paths"',
    );
  });

  it('refuses references that loop, are external or lead nowhere', () => {
    const op = (parameter: unknown) => ({
      '/a': { get: { parameters: [parameter], responses: ok } },
    });
    const withComponents = (parameters: Record<string, unknown>, ref: string) =>
      make({
        components: { parameters },
        paths: op({ $ref: ref }),
      });
    expect(() =>
      withComponents(
        {
          a: { $ref: '#/components/parameters/b' },
          b: { $ref: '#/components/parameters/a' },
        },
        '#/components/parameters/a',
      ),
    ).toThrow('refers to itself');
    expect(() => make({ paths: op({ $ref: 'other.json#/x' }) })).toThrow(
      'was not resolved',
    );
    expect(() =>
      make({ paths: op({ $ref: '#/components/parameters/none' }) }),
    ).toThrow('points to something that does not exist');
    // A schema reference to nothing fails when the schema is named.
    expect(() =>
      make({
        paths: {
          '/a': {
            get: {
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Gone' },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ).toThrow('points to something that does not exist');
  });
});

describe('normalizeOpenApi: paths and webhooks', () => {
  it('skips path items that are not objects, and follows a referenced one', () => {
    const model = make({
      paths: {
        '/bad': 'nope',
        '/shared': { $ref: '#/components/pathItems/Shared' },
      },
      webhooks: {
        bad: 3,
        'order.created': { post: { responses: ok } },
      },
      components: { pathItems: { Shared: { get: { responses: ok } } } },
    });
    expect(model.operations.map((o) => [o.path, o.method])).toEqual(
      expect.arrayContaining([
        ['/shared', 'get'],
        ['order.created', 'post'],
      ]),
    );
    expect(model.operations.some((o) => o.path === '/bad')).toBe(false);
    expect(
      model.operations.find((o) => o.path === 'order.created')?.webhook,
    ).toBe(true);
  });

  it('accepts a document with only webhooks', () => {
    const model = normalizeOpenApi(
      {
        openapi: '3.1.0',
        info,
        webhooks: { ping: { post: { responses: ok } } },
      },
      's',
    );
    expect(model.operations).toHaveLength(1);
  });
});

describe('normalizeOpenApi: schemas', () => {
  const schemaOf = (schema: unknown) => {
    const model = make({
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: { 'application/json': { schema } },
            },
            responses: ok,
          },
        },
      },
    });
    return model.operations[0]!.requestBody!.content['application/json']!
      .schema!;
  };

  it('reads boolean schemas and ignores things that are not schemas', () => {
    expect(schemaOf(true)).toEqual({});
    expect(schemaOf(false)).toEqual({ not: {} });
    expect(schemaOf('nope')).toEqual({});
  });

  it('keeps the description next to a $ref and names the target once', () => {
    const model = make({
      components: { schemas: { Pet: { type: 'object' } } },
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      a: {
                        $ref: '#/components/schemas/Pet',
                        description: 'mine',
                      },
                      b: { $ref: '#/components/schemas/Pet' },
                    },
                  },
                },
              },
            },
            responses: ok,
          },
        },
      },
    });
    const s =
      model.operations[0]!.requestBody!.content['application/json']!.schema!;
    expect(s.properties!['a']).toMatchObject({
      ref: 'Pet',
      description: 'mine',
    });
    expect(s.properties!['b']).toEqual({ ref: 'Pet' });
  });

  it('handles type arrays, null, nullable and exclusive bounds', () => {
    expect(schemaOf({ type: ['string', 'null'] })).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(schemaOf({ type: ['string', 'integer', 'null'] })).toMatchObject({
      types: ['string', 'integer'],
      nullable: true,
    });
    expect(schemaOf({ type: 'null' })).toMatchObject({ nullable: true });
    expect(schemaOf({ type: 'string', nullable: true })).toMatchObject({
      nullable: true,
    });
    expect(
      schemaOf({
        type: 'number',
        minimum: 1,
        exclusiveMinimum: true,
        maximum: 5,
        exclusiveMaximum: 9,
      }),
    ).toMatchObject({ exclusiveMinimum: 1, exclusiveMaximum: 9 });
  });

  it('carries flags, composition, additionalProperties and discriminators', () => {
    const s = schemaOf({
      type: 'object',
      uniqueItems: true,
      readOnly: true,
      writeOnly: true,
      deprecated: true,
      const: 'x',
      default: 'x',
      enum: ['x'],
      additionalProperties: { type: 'string' },
      oneOf: [{ type: 'string' }],
      anyOf: [{ type: 'number' }],
      allOf: [{ type: 'object' }],
      not: { type: 'null' },
      discriminator: { propertyName: 'kind', mapping: { a: '#/x', b: 3 } },
    });
    expect(s).toMatchObject({
      uniqueItems: true,
      readOnly: true,
      writeOnly: true,
      deprecated: true,
      const: 'x',
      additionalProperties: { type: 'string' },
      oneOf: [{ type: 'string' }],
      not: { nullable: true },
      discriminator: { propertyName: 'kind', mapping: { a: '#/x' } },
    });
    expect(schemaOf({ additionalProperties: false })).toMatchObject({
      additionalProperties: false,
    });
    expect(
      schemaOf({ discriminator: { propertyName: 'k' } }).discriminator,
    ).toMatchObject({
      propertyName: 'k',
    });
  });
});

describe('normalizeOpenApi: operations', () => {
  it('drops parameters that are unusable and keeps the rest', () => {
    const model = make({
      paths: {
        '/a': {
          get: {
            parameters: [
              'nope',
              { in: 'query' },
              { name: 'x', in: 'body' },
              { name: 'ok', in: 'query' },
              { name: 'h', in: 'header', schema: { type: 'string' } },
            ],
            responses: ok,
          },
        },
      },
    });
    expect(model.operations[0]!.parameters.map((p) => p.name)).toEqual([
      'ok',
      'h',
    ]);
  });

  it('reads media examples, response headers and default responses', () => {
    const model = make({
      components: {
        examples: { E: { value: 1, summary: 's', description: 'd' } },
      },
      paths: {
        '/a': {
          get: {
            responses: {
              '404': 'weird',
              '2XX': {
                description: 'fine',
                headers: {
                  bad: 'x',
                  'X-Rate': { description: 'r', schema: { type: 'integer' } },
                },
                content: {
                  'application/json': {
                    examples: {
                      one: { $ref: '#/components/examples/E' },
                      skipped: { summary: 'no value' },
                    },
                  },
                  'text/plain': { example: 'hi' },
                  'x/empty': {},
                },
              },
              default: { description: 'else' },
              '200': { description: 'exact' },
            },
          },
        },
      },
    });
    const statuses = model.operations[0]!.responses.map((r) => r.status);
    expect(statuses).toEqual(['200', '2XX', '404', 'default']);
    const fine = model.operations[0]!.responses.find(
      (r) => r.status === '2XX',
    )!;
    expect(fine.headers.map((h) => h.name)).toEqual(['X-Rate']);
    expect(fine.content['application/json']!.examples['one']).toMatchObject({
      value: 1,
      summary: 's',
      description: 'd',
    });
    expect(
      fine.content['application/json']!.examples['skipped'],
    ).toBeUndefined();
    expect(fine.content['text/plain']!.examples['example']).toEqual({
      value: 'hi',
    });
  });

  it('ignores responses that are not an object', () => {
    const model = make({ paths: { '/a': { get: { responses: 'x' } } } });
    expect(model.operations[0]!.responses).toEqual([]);
  });
});

describe('normalizeOpenApi: servers and security', () => {
  it('skips servers without a url and reads variables', () => {
    const model = make({
      servers: [
        'nope',
        { description: 'no url' },
        {
          url: 'https://{env}.x.test',
          variables: { env: { default: 'prod', enum: ['prod', 'dev'] } },
        },
      ],
    });
    expect(model.servers).toHaveLength(1);
    expect(model.servers[0]!.url).toBe('https://{env}.x.test');
  });

  it('reads every kind of security scheme and drops the incomplete ones', () => {
    const model = make({
      components: {
        securitySchemes: {
          key: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Key',
            description: 'k',
          },
          badKey: { type: 'apiKey', in: 'nowhere', name: 'X' },
          noName: { type: 'apiKey', in: 'query' },
          basic: { type: 'http', scheme: 'Basic' },
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          noScheme: { type: 'http' },
          oauth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://a.test/auth',
                tokenUrl: 'https://a.test/token',
                refreshUrl: 'https://a.test/refresh',
                scopes: { read: 'Read', n: 3 },
              },
              implicit: { authorizationUrl: 'https://a.test/auth' },
              junk: 'x',
            },
          },
          oauthNone: { type: 'oauth2' },
          oidc: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://a.test/.well-known',
          },
          oidcNone: { type: 'openIdConnect' },
          mtls: { type: 'mutualTLS' },
          other: { type: 'unknown' },
          junk: 'x',
        },
      },
      security: [{ key: [], bearer: [] }, { oauth: ['read'] }],
    });
    const names = Object.keys(model.securitySchemes);
    expect(names).toEqual(
      expect.arrayContaining([
        'key',
        'basic',
        'bearer',
        'oauth',
        'oauthNone',
        'oidc',
        'mtls',
      ]),
    );
    for (const gone of [
      'badKey',
      'noName',
      'noScheme',
      'oidcNone',
      'other',
      'junk',
    ])
      expect(names).not.toContain(gone);
    expect(model.securitySchemes['basic']).toMatchObject({ scheme: 'basic' });
    expect(model.securitySchemes['oauth']).toMatchObject({
      type: 'oauth2',
      flows: { authorizationCode: { scopes: { read: 'Read', n: '3' } } },
    });
  });
});
