import {
  type AuthValues,
  buildHttpRequest,
  defaultValues,
  emptyValues,
  pickSecurity,
  serverUrl,
} from './request.ts';
import {
  constraints,
  exampleFromSchema,
  mergeAllOf,
  typeLabel,
  validateInput,
} from './schema-view.ts';
import {
  curl,
  defaultSampleLanguages,
  go,
  javascript,
  python,
} from './samples.ts';
import { schemaFileName } from './text.ts';
import type { ApiOperation, ApiSchema, ApiSecurityScheme } from './types.ts';

const op: ApiOperation = {
  id: 'create-pet',
  method: 'post',
  path: '/pets/{petId}/toys',
  tags: [],
  parameters: [
    { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
    {
      name: 'tags',
      in: 'query',
      required: false,
      schema: { type: 'array', items: { type: 'string' } },
    },
    { name: 'X-Trace', in: 'header', required: false },
  ],
  responses: [],
  security: [{ key: [] }, { bearer: [] }],
};
const schemes: Record<string, ApiSecurityScheme> = {
  key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
  bearer: { type: 'http', scheme: 'bearer' },
  basic: { type: 'http', scheme: 'basic' },
};
const body = {
  contentType: 'application/json',
  text: '{"name":"Ball","owner":{"id":1,"tag":"it\'s"},"ok":true,"none":null,"list":[1,2]}',
};

describe('buildHttpRequest', () => {
  const values = () => ({
    ...emptyValues(),
    path: { petId: 'a/b c' },
    query: { tags: 'x, y' },
    header: { 'X-Trace': 't1' },
    body,
  });

  it('fills the path, repeats list values and applies the first filled-in security alternative', () => {
    const auth: AuthValues = { bearer: { value: 'tok' } };
    const req = buildHttpRequest(
      op,
      schemes,
      'https://api.test/v1',
      values(),
      auth,
    );
    expect(req.method).toBe('POST');
    expect(req.url).toBe(
      'https://api.test/v1/pets/a%2Fb%20c/toys?tags=x&tags=y',
    );
    expect(req.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Trace', 't1'],
      ['Authorization', 'Bearer tok'],
    ]);
  });

  it('joins lists as the parameter style says', () => {
    const csv: ApiOperation = {
      ...op,
      parameters: [
        {
          name: 'ids',
          in: 'query',
          required: false,
          explode: false,
          schema: { type: 'array' },
        },
      ],
    };
    const v = { ...emptyValues(), query: { ids: '1,2' } };
    expect(buildHttpRequest(csv, schemes, 'http://h', v, {}).url).toBe(
      'http://h/pets/%7BpetId%7D/toys?ids=1%2C2'.replace(
        '%7BpetId%7D',
        '{petId}',
      ),
    );
  });

  it('uses placeholders for samples and leaves secrets out of real requests', () => {
    const sample = buildHttpRequest(
      op,
      schemes,
      'https://api.test',
      emptyValues(),
      {},
      { placeholders: true },
    );
    expect(sample.url).toBe('https://api.test/pets/{petId}/toys');
    expect(sample.headers).toEqual([['X-Api-Key', 'YOUR_API_KEY']]);
    const real = buildHttpRequest(
      op,
      schemes,
      'https://api.test',
      emptyValues(),
      {},
    );
    expect(real.headers).toEqual([]);
  });

  it('encodes Basic credentials as UTF-8', () => {
    const basic: ApiOperation = { ...op, security: [{ basic: [] }] };
    const req = buildHttpRequest(basic, schemes, 'http://h', emptyValues(), {
      basic: { username: 'zoë', password: 'pw' },
    });
    expect(req.headers).toEqual([
      ['Authorization', `Basic ${Buffer.from('zoë:pw').toString('base64')}`],
    ]);
  });

  it('chooses the alternative that is filled in', () => {
    expect(pickSecurity(op, { bearer: { value: 'x' } })).toEqual({
      bearer: [],
    });
    expect(pickSecurity(op, {})).toEqual({ key: [] });
  });

  it('puts an API key in the query when the scheme says so', () => {
    const q: ApiOperation = { ...op, security: [{ q: [] }] };
    const req = buildHttpRequest(
      q,
      { q: { type: 'apiKey', in: 'query', name: 'k' } },
      'http://h',
      emptyValues(),
      { q: { value: 's e' } },
    );
    expect(req.url).toBe('http://h/pets/{petId}/toys?k=s%20e');
  });
});

describe('server and defaults', () => {
  it('fills server variables', () => {
    const server = {
      url: 'https://{region}.x.com/{v}/',
      variables: { region: { default: 'eu' }, v: { default: 'v1' } },
    };
    expect(serverUrl(server)).toBe('https://eu.x.com/v1');
    expect(serverUrl(server, { region: 'us' })).toBe('https://us.x.com/v1');
    expect(serverUrl(undefined)).toBe('');
  });

  it('starts the form with spec examples and defaults', () => {
    const v = defaultValues(
      {
        ...op,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 10 },
          },
        ],
      },
      body,
    );
    expect(v.query).toEqual({ limit: '10' });
    expect(v.body).toBe(body);
  });
});

describe('code samples', () => {
  const request = buildHttpRequest(
    op,
    schemes,
    'https://api.test',
    { ...emptyValues(), path: { petId: '7' }, query: { tags: 'a' }, body },
    { key: { value: "se'cret" } },
  );

  it('curl', () => {
    expect(curl.generate(request)).toBe(`curl --request POST \\
  --url 'https://api.test/pets/7/toys?tags=a' \\
  --header 'Content-Type: application/json' \\
  --header 'X-Api-Key: se'\\''cret' \\
  --data '{
  "name": "Ball",
  "owner": {
    "id": 1,
    "tag": "it'\\''s"
  },
  "ok": true,
  "none": null,
  "list": [
    1,
    2
  ]
}'`);
  });

  it('javascript', () => {
    expect(javascript.generate(request))
      .toBe(`const response = await fetch("https://api.test/pets/7/toys?tags=a", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Api-Key": "se'cret",
  },
  body: JSON.stringify({
    "name": "Ball",
    "owner": {
      "id": 1,
      "tag": "it's"
    },
    "ok": true,
    "none": null,
    "list": [
      1,
      2
    ]
  }),
});

const data = await response.json();
console.log(data);`);
  });

  it('python', () => {
    const out = python.generate(request);
    expect(out).toContain(
      'response = requests.request(\n    "POST",\n    "https://api.test/pets/7/toys?tags=a",',
    );
    expect(out).toContain('"ok": True');
    expect(out).toContain('"none": None');
    expect(out).toContain('json={\n        "name": "Ball",');
    expect(out).toMatch(/\n {4}json=\{[\s\S]*\n {4}\},\n\)/);
  });

  it('go', () => {
    const out = go.generate(request);
    expect(out).toContain('payload := strings.NewReader(`{');
    expect(out).toContain(
      'http.NewRequest("POST", "https://api.test/pets/7/toys?tags=a", payload)',
    );
    expect(out).toContain('req.Header.Add("X-Api-Key", "se\'cret")');
    expect(out).toContain('"strings"');
  });

  it('handle requests without a body and with text bodies', () => {
    const get = buildHttpRequest(
      { ...op, method: 'get', security: [] },
      schemes,
      'https://a.test',
      emptyValues(),
      {},
    );
    expect(curl.generate(get)).toBe(
      "curl --request GET \\\n  --url 'https://a.test/pets/{petId}/toys'",
    );
    expect(go.generate(get)).not.toContain('strings');
    expect(go.generate(get)).toContain(
      '"GET", "https://a.test/pets/{petId}/toys", nil)',
    );
    const text = {
      method: 'PUT',
      url: 'http://h',
      headers: [['Content-Type', 'text/plain']] as [string, string][],
      body: { contentType: 'text/plain', text: 'a`b' },
    };
    expect(go.generate(text)).toContain('strings.NewReader("a`b")');
    expect(python.generate(text)).toContain('data="a`b"');
  });

  it('are the four built-in languages', () => {
    expect(defaultSampleLanguages.map((l) => l.id)).toEqual([
      'curl',
      'javascript',
      'python',
      'go',
    ]);
  });
});

describe('schema helpers', () => {
  const schemas: Record<string, ApiSchema> = {
    Node: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        next: { ref: 'Node' },
        secret: { type: 'string', writeOnly: true },
      },
    },
    Base: {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' } },
    },
  };
  const lookup = (n: string) => schemas[n];

  it('builds examples from a schema and stops at circular references', () => {
    const value = exampleFromSchema({ ref: 'Node' }, lookup, {
      skip: 'writeOnly',
    }) as Record<string, unknown>;
    expect(value.id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(value).not.toHaveProperty('secret');
    // depth 3: Node -> next -> next -> next ends with {}
    expect(JSON.stringify(value)).toContain('"next":{}');
  });

  it('prefers the example, default, then the first enum value', () => {
    expect(
      exampleFromSchema(
        { type: 'string', examples: ['x'], default: 'd' },
        lookup,
      ),
    ).toBe('x');
    expect(exampleFromSchema({ type: 'string', default: 'd' }, lookup)).toBe(
      'd',
    );
    expect(
      exampleFromSchema({ type: 'string', enum: ['a', 'b'] }, lookup),
    ).toBe('a');
    expect(
      exampleFromSchema(
        { oneOf: [{ type: 'integer', minimum: 5 }, { type: 'string' }] },
        lookup,
      ),
    ).toBe(5);
  });

  it('merges allOf and labels types', () => {
    const merged = mergeAllOf(
      {
        allOf: [
          { ref: 'Base' },
          { properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
      lookup,
    );
    expect(Object.keys(merged.properties ?? {})).toEqual(['a', 'b']);
    expect(merged.required).toEqual(['a', 'b']);
    expect(typeLabel({ type: 'array', items: { ref: 'Pet' } })).toBe('Pet[]');
    expect(
      typeLabel({ type: 'string', format: 'date-time', nullable: true }),
    ).toBe('string<date-time> | null');
    expect(typeLabel({ oneOf: [] })).toBe('one of');
    expect(typeLabel({ types: ['string', 'integer'] })).toBe(
      'string | integer',
    );
    expect(typeLabel(undefined)).toBe('any');
  });

  it('validates typed values against the schema', () => {
    expect(validateInput({ type: 'integer', minimum: 1 }, '', true)).toBe(
      'Required',
    );
    expect(
      validateInput({ type: 'integer', minimum: 1 }, '', false),
    ).toBeUndefined();
    expect(validateInput({ type: 'integer', minimum: 1 }, 'x', false)).toBe(
      'Must be an integer',
    );
    expect(validateInput({ type: 'integer', minimum: 1 }, '1.5', false)).toBe(
      'Must be an integer',
    );
    expect(validateInput({ type: 'integer', minimum: 1 }, '0', false)).toBe(
      'Must be at least 1',
    );
    expect(
      validateInput({ type: 'number', exclusiveMaximum: 5 }, '5', false),
    ).toBe('Must be less than 5');
    expect(
      validateInput({ type: 'string', enum: ['a', 'b'] }, 'c', false),
    ).toBe('Must be one of: a, b');
    expect(
      validateInput({ type: 'string', pattern: '^a+$' }, 'ab', false),
    ).toBe('Must match ^a+$');
    expect(validateInput({ type: 'string', maxLength: 2 }, 'abc', false)).toBe(
      'At most 2 characters',
    );
    expect(validateInput({ type: 'boolean' }, 'yes', false)).toBe(
      'Must be true or false',
    );
    expect(
      validateInput(
        { type: 'array', items: { type: 'integer' }, maxItems: 2 },
        '1,2,3',
        false,
      ),
    ).toBe('At most 2 items');
    expect(
      validateInput(
        { type: 'array', items: { type: 'integer' } },
        '1, x',
        false,
      ),
    ).toBe('Must be an integer');
    expect(
      validateInput({ type: 'string', pattern: '(' }, 'x', false),
    ).toBeUndefined();
    expect(validateInput({ type: 'integer' }, '42', true)).toBeUndefined();
  });

  it('lists constraints', () => {
    expect(constraints({ minimum: 1, maxLength: 5, pattern: '^a' })).toEqual([
      'min 1',
      'max length 5',
      'pattern ^a',
    ]);
  });

  it('names schema files so that different names never share a file', () => {
    const names = [
      'Pet',
      'pet',
      'Pet.Item',
      'pet.item',
      'a/b',
      'a_b',
      'é',
      'Pet~',
    ];
    const files = names.map(schemaFileName);
    expect(new Set(files).size).toBe(names.length);
    for (const f of files) expect(f).toMatch(/^[a-z0-9_.~-]+$/);
  });
});

describe('buildHttpRequest: cookies, keys elsewhere and basic credentials', () => {
  const operation: ApiOperation = {
    ...op,
    path: '/x',
    parameters: [
      { name: 'sid', in: 'cookie', required: false },
      { name: 'q', in: 'query', required: false },
      { name: 'ids', in: 'query', required: false, schema: { type: 'array' } },
    ],
    security: [{ keyQ: [] }, { keyC: [] }, { basic: [] }, { missing: [] }],
  };
  const all: Record<string, ApiSecurityScheme> = {
    keyQ: { type: 'apiKey', in: 'query', name: 'key' },
    keyC: { type: 'apiKey', in: 'cookie', name: 'session' },
    basic: { type: 'http', scheme: 'basic' },
  };
  const build = (auth: AuthValues, extra = {}, placeholders = false) =>
    buildHttpRequest(
      operation,
      all,
      'https://h.test',
      { ...emptyValues(), cookie: { sid: 'abc' }, ...extra },
      auth,
      { placeholders },
    );

  it('sends cookie parameters in one Cookie header', () => {
    expect(build({}).headers).toEqual([['Cookie', 'sid=abc']]);
  });

  it('puts an API key where the scheme says', () => {
    expect(build({ keyQ: { value: 'k1' } }).url).toBe(
      'https://h.test/x?key=k1',
    );
    const withCookie = { ...operation, security: [{ keyC: [] }] };
    const req = buildHttpRequest(
      withCookie,
      all,
      'https://h.test',
      emptyValues(),
      {
        keyC: { value: 's1' },
      },
    );
    expect(req.headers).toEqual([['Cookie', 'session=s1']]);
  });

  it('encodes basic credentials, or shows a placeholder for samples', () => {
    const only = { ...operation, security: [{ basic: [] }] };
    const base = [only, all, 'https://h.test', emptyValues()] as const;
    expect(
      buildHttpRequest(...base, { basic: { username: 'u', password: 'p' } })
        .headers,
    ).toEqual([['Authorization', `Basic ${btoa('u:p')}`]]);
    expect(
      buildHttpRequest(...base, {}, { placeholders: true }).headers,
    ).toEqual([['Authorization', 'Basic YOUR_BASE64_CREDENTIALS']]);
    expect(buildHttpRequest(...base, {}).headers).toEqual([]);
  });

  it('ignores a scheme the spec does not define', () => {
    const only = { ...operation, security: [{ missing: [] }] };
    expect(
      buildHttpRequest(only, all, 'https://h.test', emptyValues(), {}).headers,
    ).toEqual([]);
  });

  it('sends a list with no style repeated', () => {
    expect(build({}, { query: { ids: 'a,b' } }).url).toBe(
      'https://h.test/x?ids=a&ids=b',
    );
  });
});
