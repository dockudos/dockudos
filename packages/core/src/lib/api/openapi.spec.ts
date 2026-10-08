import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../config.ts';
import { bundleExternalRefs, parseSpecText } from './bundle.ts';
import { generateOpenApi } from './generate-openapi.ts';
import { normalizeOpenApi } from './openapi.ts';
import {
  detectSpec,
  generateApiDocs,
  loadOpenApi,
  readSpecText,
  resolveSpecLocation,
} from './sources.ts';
import { ApiSpecError } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, 'fixtures', name);
const load = async (name: string) => {
  const location = fixture(name);
  const text = await readFile(location, 'utf8');
  return loadOpenApi(detectSpec(text, location), location, here);
};

describe('reading specs', () => {
  it('reads JSON and YAML', async () => {
    expect(parseSpecText('{"a":1}', 'x')).toEqual({ a: 1 });
    expect(parseSpecText('a: 1\nb: [x]', 'x')).toEqual({ a: 1, b: ['x'] });
  });

  it('names the source when a spec cannot be parsed', () => {
    expect(() => parseSpecText('{"a":', 'specs/bad.json')).toThrow(
      /specs\/bad\.json: cannot be parsed/,
    );
    expect(() => parseSpecText('a: [', 'specs/bad.yaml')).toThrow(ApiSpecError);
  });

  it('reads a hosted spec and fails with the URL and reason when it cannot', async () => {
    const ok = vi.fn(
      async (_url: unknown) => new Response('{"openapi":"3.0.0"}'),
    );
    expect(
      await readSpecText('https://api.test/o.json', here, { fetch: ok }),
    ).toContain('openapi');
    expect(ok.mock.calls[0]?.[0]).toBe('https://api.test/o.json');

    const missing = async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' });
    await expect(
      readSpecText('https://api.test/o.json', here, { fetch: missing }),
    ).rejects.toThrow(
      'https://api.test/o.json: could not be fetched: the server answered 404 Not Found',
    );
    const down = async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND api.test'),
      });
    };
    await expect(
      readSpecText('https://api.test/o.json', here, { fetch: down }),
    ).rejects.toThrow(/could not be fetched: getaddrinfo ENOTFOUND api\.test/);
  });

  it('says where a missing file was looked for', async () => {
    await expect(readSpecText('specs/none.yaml', here)).rejects.toThrow(
      /specs\/none\.yaml: file not found \(looked for .*none\.yaml\)/,
    );
  });

  it('tells Swagger 2.0 and other documents apart', () => {
    expect(() => normalizeOpenApi({ swagger: '2.0' }, 's')).toThrow(
      /Swagger 2\.0/,
    );
    expect(() => normalizeOpenApi({ hello: 1 }, 's')).toThrow(
      /not an OpenAPI 3/,
    );
    expect(() => detectSpec('hello: 1', 's.yaml')).toThrow(
      /not an OpenAPI, AsyncAPI or GraphQL/,
    );
    expect(detectSpec('openapi: 3.1.0', 's.yaml').kind).toBe('openapi');
    expect(detectSpec('asyncapi: 3.0.0', 's.yaml').kind).toBe('asyncapi');
    expect(detectSpec('type Query { a: Int }', 'schema.graphql').kind).toBe(
      'graphql',
    );
  });

  it('resolves references against files and URLs', () => {
    expect(resolveSpecLocation('https://a.test/x/o.json', './s.json')).toBe(
      'https://a.test/x/s.json',
    );
    expect(resolveSpecLocation('/p/x/o.json', '../s.json')).toBe('/p/s.json');
    expect(resolveSpecLocation('/p/o.json', 'https://b.test/s.json')).toBe(
      'https://b.test/s.json',
    );
  });
});

describe('external references', () => {
  const files: Record<string, string> = {
    '/p/main.yaml': `openapi: 3.0.3
info: { title: T, version: '1' }
paths:
  /a:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: './schemas/a.yaml#/A' }
  /b:
    $ref: './paths/b.yaml'
`,
    '/p/schemas/a.yaml': `A:
  type: object
  properties:
    self: { $ref: '#/A' }
    other: { $ref: './b.yaml#/B' }
`,
    '/p/schemas/b.yaml': `B:
  type: object
  properties:
    back: { $ref: './a.yaml#/A' }
`,
    '/p/paths/b.yaml': `get:
  responses:
    '200': { description: ok }
`,
  };
  const read = async (loc: string) => {
    const f = files[loc];
    if (f === undefined) throw new ApiSpecError(loc, 'file not found');
    return f;
  };

  it('copies referenced pieces in, once, so cycles across files end', async () => {
    const doc = await bundleExternalRefs(
      parseSpecText(files['/p/main.yaml'] as string, 'm'),
      {
        location: '/p/main.yaml',
        read,
        resolveLocation: resolveSpecLocation,
      },
    );
    const model = normalizeOpenApi(doc, 'main.yaml');
    expect(model.operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'get /a',
      'get /b',
    ]);
    expect(Object.keys(model.schemas).sort()).toEqual(['A', 'B']);
    expect(model.schemas.A?.properties?.self).toEqual({ ref: 'A' });
    expect(model.schemas.A?.properties?.other).toEqual({ ref: 'B' });
    expect(model.schemas.B?.properties?.back).toEqual({ ref: 'A' });
  });

  it('fails with the reference when its target is missing', async () => {
    const broken: Record<string, string> = {
      ...files,
      '/p/schemas/b.yaml': 'C: {}\n',
    };
    await expect(
      bundleExternalRefs(parseSpecText(files['/p/main.yaml'] as string, 'm'), {
        location: '/p/main.yaml',
        read: async (l) =>
          broken[l] ?? Promise.reject(new ApiSpecError(l, 'file not found')),
        resolveLocation: resolveSpecLocation,
      }),
    ).rejects.toThrow(/points to something that does not exist/);
  });
});

describe('model', () => {
  it('normalises OpenAPI 3.1: nullable types, bounds, composition, webhooks', async () => {
    const model = await load('composed-31.yaml');
    expect(model.operations.map((o) => o.id)).toEqual([
      'getnode',
      'putnode',
      'health',
      'nodechanged',
    ]);
    const node = model.schemas.Node;
    expect(node?.properties?.note).toMatchObject({
      type: 'string',
      nullable: true,
      minLength: 1,
    });
    expect(node?.properties?.parent).toEqual({ ref: 'Node' });
    expect(node?.properties?.children?.items).toEqual({ ref: 'Node' });
    expect(node?.properties?.rank).toMatchObject({
      exclusiveMinimum: 0,
      maximum: 10,
    });
    expect(model.schemas.Leaf?.allOf).toHaveLength(2);
    expect(model.operations.find((o) => o.webhook)?.id).toBe('nodechanged');
  });

  it('normalises OpenAPI 3.0 to the same shape', async () => {
    const model = await load('legacy-30.json');
    const op = model.operations[0];
    expect(op?.parameters[0]?.schema).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 1,
      maximum: 100,
    });
    expect(op?.parameters[0]?.schema?.minimum).toBeUndefined();
    expect(op?.responses[0]?.content['application/json']?.schema).toMatchObject(
      {
        type: 'string',
        nullable: true,
        examples: ['hi'],
      },
    );
  });

  it('merges path and operation parameters, resolves parameter and response refs', async () => {
    const model = await load('composed-31.yaml');
    const get = model.operations[0];
    expect(
      get?.parameters.map((p) => `${p.in}:${p.name}:${p.required}`),
    ).toEqual(['path:id:true', 'query:expand:false']);
    expect(get?.responses.map((r) => r.status)).toEqual(['200', 'default']);
    expect(
      get?.responses[1]?.content['application/problem+json'],
    ).toBeDefined();
  });

  it('uses global security unless the operation sets its own', async () => {
    const model = await load('composed-31.yaml');
    expect(model.operations.find((o) => o.id === 'getnode')?.security).toEqual([
      { key: [] },
    ]);
    expect(model.operations.find((o) => o.id === 'health')?.security).toEqual(
      [],
    );
    expect(model.securitySchemes.key).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-Key',
    });
  });

  it('gives operations without an operationId stable, unique ids', () => {
    const model = normalizeOpenApi(
      {
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: {
          '/a/{id}': { get: { responses: {} }, post: { responses: {} } },
          '/a-id': { get: { responses: {} } },
        },
      },
      's',
    );
    expect(model.operations.map((o) => o.id)).toEqual([
      'get-a-id',
      'post-a-id',
      'get-a-id-2',
    ]);
  });

  it('reads the real Petstore', async () => {
    const model = await load('petstore.json');
    expect(model.operations).toHaveLength(19);
    expect(model.schemas.Pet?.properties?.category).toEqual({
      ref: 'Category',
    });
    expect(Object.keys(model.securitySchemes).sort()).toEqual([
      'api_key',
      'petstore_auth',
    ]);
  });
});

describe('pages', () => {
  const opts = {
    name: 'petstore',
    mount: 'api',
    groupBy: 'tag',
    playground: true,
  } as const;

  it('writes one page for every operation', async () => {
    const result = generateOpenApi(await load('petstore.json'), opts);
    const spec = JSON.parse(
      await readFile(fixture('petstore.json'), 'utf8'),
    ) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const inSpec = Object.values(spec.paths).reduce(
      (n, item) =>
        n +
        [
          'get',
          'put',
          'post',
          'delete',
          'patch',
          'head',
          'options',
          'trace',
        ].filter((m) => m in item).length,
      0,
    );
    expect(result.operations).toBe(inSpec);
    expect(result.pages).toBe(inSpec);
    const pages = result.files.filter(
      (f) => f.file.endsWith('.mdx') && !f.file.endsWith('index.mdx'),
    );
    expect(pages).toHaveLength(inSpec);
    expect(new Set(pages.map((p) => p.file)).size).toBe(inSpec);
  });

  it('groups by tag or by path and keeps webhooks', async () => {
    const model = await load('composed-31.yaml');
    const byTag = generateOpenApi(model, { ...opts, name: 'c' });
    const names = byTag.files
      .map((f) => f.file)
      .filter((f) => f.endsWith('.mdx'));
    expect(names).toContain('docs/api/nodes/getnode.mdx');
    expect(names).toContain('docs/api/endpoints/health.mdx');
    const byPath = generateOpenApi(model, {
      ...opts,
      name: 'c',
      groupBy: 'path',
    });
    expect(byPath.files.map((f) => f.file)).toContain(
      'docs/api/nodes/getnode.mdx',
    );
    expect(byPath.files.map((f) => f.file)).toContain(
      'docs/api/health/health.mdx',
    );
    expect(byTag.pages).toBe(4);
  });

  it('puts generated metadata in the frontmatter and nothing from the spec raw in the MDX', async () => {
    const model = await load('composed-31.yaml');
    const { files } = generateOpenApi(model, { ...opts, name: 'c' });
    const overview =
      files.find((f) => f.file === 'docs/api/index.mdx')?.content ?? '';
    expect(overview).toContain('title: "Composed"');
    // Braces, tags and an `import` line from the description are escaped, not interpreted.
    expect(overview).toContain('\\{braces\\}');
    expect(overview).toContain('\\<tags\\>');
    expect(overview).not.toMatch(/^import x/m);
    expect(overview).toContain("&#105;mport x from 'y'");
    expect(overview).not.toMatch(/(?<!\\)<!--/);
    const page =
      files.find((f) => f.file === 'docs/api/nodes/getnode.mdx')?.content ?? '';
    expect(page).toContain('method: get');
    expect(page).toContain('endpoint: "/nodes/{id}"');
    expect(page).toContain(
      'import data from "../../../.dockudos/api/c/ops/getnode.json"',
    );
    expect(page).toContain('<Visibility for="agents">');
  });

  it('embeds a one-level view of schemas and writes the rest as files to load later', async () => {
    const { files } = generateOpenApi(await load('composed-31.yaml'), {
      ...opts,
      name: 'c',
    });
    const data = JSON.parse(
      files.find((f) => f.file.endsWith('ops/getnode.json'))?.content ?? '{}',
    );
    const schema =
      data.operation.responses[0].content['application/json'].schema;
    expect(schema.ref).toBe('Node');
    expect(schema.properties.parent).toEqual({ ref: 'Node' });
    const example =
      data.operation.responses[0].content['application/json'].examples.example
        .value;
    expect(example).toMatchObject({ rank: 1 });
    // readOnly fields are not asked for in a request, but are shown in a response
    expect(example).toHaveProperty('id');
    expect(files.map((f) => f.file)).toContain(
      'public/_dockudos/api/c/schemas/~node.json',
    );
  });

  it('does not show the playground for webhooks or when it is off', async () => {
    const model = await load('composed-31.yaml');
    const on = generateOpenApi(model, { ...opts, name: 'c' });
    const hook = JSON.parse(
      on.files.find((f) => f.file.endsWith('ops/nodechanged.json'))?.content ??
        '{}',
    );
    expect(hook.noPlayground).toBe(true);
    const get = JSON.parse(
      on.files.find((f) => f.file.endsWith('ops/getnode.json'))?.content ??
        '{}',
    );
    expect(get.noPlayground).toBeUndefined();
    const off = generateOpenApi(model, {
      ...opts,
      name: 'c',
      playground: false,
    });
    expect(
      JSON.parse(
        off.files.find((f) => f.file.endsWith('ops/getnode.json'))?.content ??
          '{}',
      ).noPlayground,
    ).toBe(true);
  });
});

describe('generateApiDocs', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dockudos-api-'));
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(
      join(root, 'specs/petstore.json'),
      await readFile(fixture('petstore.json')),
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const config = (sources: unknown[]) =>
    parseConfig({ name: 'T', openapi: { sources } });

  it('writes the pages, skips an unchanged spec, and removes pages that left the spec', async () => {
    const cfg = config([
      { name: 'petstore', spec: 'specs/petstore.json', path: 'reference' },
    ]);
    const first = await generateApiDocs({ root, config: cfg });
    expect(first[0]).toMatchObject({
      operations: 19,
      pages: 19,
      cached: false,
    });
    expect(await readdir(join(root, 'docs/reference'))).toContain('index.mdx');

    const second = await generateApiDocs({ root, config: cfg });
    expect(second[0]).toMatchObject({ cached: true });

    // Remove one operation from the spec: its page and data go, everything else stays.
    const spec = JSON.parse(
      await readFile(join(root, 'specs/petstore.json'), 'utf8'),
    );
    delete spec.paths['/user/logout'];
    await writeFile(join(root, 'specs/petstore.json'), JSON.stringify(spec));
    await writeFile(join(root, 'docs/notes.mdx'), '# mine');
    const third = await generateApiDocs({ root, config: cfg });
    expect(third[0]).toMatchObject({
      operations: 18,
      pages: 18,
      cached: false,
    });
    await expect(
      readFile(join(root, 'docs/reference/user/logoutuser.mdx')),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, '.dockudos/api/petstore/ops/logoutuser.json')),
    ).rejects.toThrow();
    expect(await readFile(join(root, 'docs/notes.mdx'), 'utf8')).toBe('# mine');
  });

  it('stops with the location when a spec cannot be read', async () => {
    const cfg = config([{ name: 'x', spec: 'https://nowhere.test/o.json' }]);
    const fail = async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND nowhere.test'),
      });
    };
    await expect(
      generateApiDocs({ root, config: cfg, fetch: fail }),
    ).rejects.toThrow(
      'https://nowhere.test/o.json: could not be fetched: getaddrinfo ENOTFOUND nowhere.test',
    );
  });

  it('rejects two sources with the same name or path in docs.json', () => {
    expect(() =>
      config([
        { name: 'a', spec: 'a.json' },
        { name: 'a', spec: 'b.json' },
      ]),
    ).toThrow(/used twice/);
    expect(() =>
      config([
        { name: 'a', spec: 'a.json', path: 'api' },
        { name: 'b', spec: 'b.json', path: 'api' },
      ]),
    ).toThrow(/used twice/);
  });
});
