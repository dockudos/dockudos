import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphqlSync, getIntrospectionQuery, buildSchema } from 'graphql';
import { parseConfig } from '../config.ts';
import {
  detectSpec,
  generateApiDocs,
  loadOpenApi,
  setSourceGenerator,
} from './sources.ts';
import { ApiSpecError } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFile(join(here, 'fixtures', name), 'utf8');
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-sources-'));
  await mkdir(join(root, 'specs'), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const cfg = (o: { sources?: unknown[]; reference?: unknown[] }) =>
  parseConfig({
    name: 'T',
    openapi: { sources: o.sources ?? [] },
    reference: { sources: o.reference ?? [] },
  });

describe('detectSpec', () => {
  it('reads a GraphQL introspection result as JSON, and SDL as text', () => {
    const schema = buildSchema('type Query { a: Int }');
    const result = graphqlSync({ schema, source: getIntrospectionQuery() });
    const json = JSON.stringify(result);
    expect(detectSpec(json, 'schema.graphql')).toMatchObject({
      kind: 'graphql',
      doc: expect.anything(),
    });
    expect(detectSpec(json, 'x.json')).toMatchObject({ kind: 'graphql' });
    const sdl = detectSpec('type Query { a: Int }', 'x.gql');
    expect(sdl).toEqual({ kind: 'graphql', text: 'type Query { a: Int }' });
    expect(detectSpec('{"a":1}', 'x.json', 'graphql')).toMatchObject({
      kind: 'graphql',
    });
  });

  it('honours a forced type and refuses a document that is none of them', () => {
    expect(detectSpec('{"hello":1}', 'x.json', 'openapi').kind).toBe('openapi');
    expect(() => detectSpec('{"hello":1}', 'x.json')).toThrow(ApiSpecError);
    expect(() => detectSpec('null', 'x.json')).toThrow('is not an OpenAPI');
  });
});

describe('generateApiDocs: every kind of source', () => {
  it('writes AsyncAPI and GraphQL pages, and skips them while unchanged', async () => {
    await writeFile(
      join(root, 'specs/chat.yaml'),
      await fixture('chat-2.yaml'),
    );
    await writeFile(
      join(root, 'specs/shop.graphql'),
      await fixture('shop.graphql'),
    );
    const config = cfg({
      sources: [
        { name: 'chat', spec: 'specs/chat.yaml' },
        { name: 'shop', spec: 'specs/shop.graphql', path: 'gql' },
      ],
    });
    const log: string[] = [];
    const first = await generateApiDocs({
      root,
      config,
      log: (l) => log.push(l),
    });
    expect(first.map((r) => [r.name, r.kind, r.cached])).toEqual([
      ['chat', 'asyncapi', false],
      ['shop', 'graphql', false],
    ]);
    expect(await exists(join(root, 'docs/gql/index.mdx'))).toBe(true);
    expect(log.some((l) => l.startsWith('chat:'))).toBe(true);

    const second = await generateApiDocs({
      root,
      config,
      log: (l) => log.push(l),
    });
    expect(second.every((r) => r.cached)).toBe(true);
    expect(log).toContain('chat: unchanged');
  });

  it('regenerates when a generated file has been deleted, or with force', async () => {
    await writeFile(
      join(root, 'specs/shop.graphql'),
      await fixture('shop.graphql'),
    );
    const config = cfg({
      sources: [{ name: 'shop', spec: 'specs/shop.graphql' }],
    });
    await generateApiDocs({ root, config });
    await rm(join(root, 'docs/shop'), { recursive: true });
    expect((await generateApiDocs({ root, config }))[0]!.cached).toBe(false);
    expect(
      (await generateApiDocs({ root, config, force: true }))[0]!.cached,
    ).toBe(false);
  });

  it('uses a generator that another module registers for a kind', async () => {
    await writeFile(
      join(root, 'specs/shop.graphql'),
      await fixture('shop.graphql'),
    );
    const config = cfg({
      sources: [{ name: 'shop', spec: 'specs/shop.graphql' }],
    });
    const custom = vi.fn(async () => ({
      files: [{ file: 'docs/custom.mdx', content: '# custom' }],
      operations: 1,
      pages: 1,
    }));
    setSourceGenerator('graphql', custom);
    const out = await generateApiDocs({ root, config });
    expect(custom).toHaveBeenCalled();
    expect(out[0]).toMatchObject({ pages: 1, operations: 1 });
    expect(await readFile(join(root, 'docs/custom.mdx'), 'utf8')).toBe(
      '# custom',
    );
  });

  it('refuses to write outside the project', async () => {
    await writeFile(
      join(root, 'specs/shop.graphql'),
      await fixture('shop.graphql'),
    );
    const config = cfg({
      sources: [{ name: 'shop', spec: 'specs/shop.graphql' }],
    });
    setSourceGenerator('graphql', async () => ({
      files: [{ file: '../escape.mdx', content: 'x' }],
      operations: 0,
      pages: 1,
    }));
    await expect(generateApiDocs({ root, config })).rejects.toThrow(
      'refusing to write outside the project',
    );
  });
});

// The TypeScript compiler is slow to start, more so with other test files running beside this one.
describe('generateApiDocs: code references', { timeout: 30_000 }, () => {
  const sdk = async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/sdk.ts'), await fixture('sdk.ts'));
    await writeFile(join(root, 'src/index.ts'), await fixture('sdk-index.ts'));
  };
  const sources = (extra = {}) => [
    { name: 'sdk', type: 'typescript', input: 'src/index.ts', ...extra },
  ];

  it('writes pages for a reference source, caches it, and removes it when it goes', async () => {
    await sdk();
    const log: string[] = [];
    const config = cfg({ reference: sources() });
    const first = await generateApiDocs({
      root,
      config,
      log: (l) => log.push(l),
    });
    expect(first[0]).toMatchObject({ name: 'sdk', cached: false });
    expect(first[0]!.pages).toBeGreaterThan(0);
    expect(log.some((l) => /^sdk: \d+ pages$/.test(l))).toBe(true);
    const index = join(root, 'docs/sdk/index.mdx');
    expect(await exists(index)).toBe(true);

    const second = await generateApiDocs({ root, config });
    expect(second[0]).toMatchObject({ cached: true, pages: 0 });

    // Dropped from docs.json: the pages this tool wrote are cleaned up.
    await generateApiDocs({ root, config: cfg({}) });
    expect(await exists(index)).toBe(false);
  });

  it('writes again when force is given', async () => {
    await sdk();
    const config = cfg({ reference: sources() });
    await generateApiDocs({ root, config });
    const again = await generateApiDocs({ root, config, force: true });
    expect(again[0]!.cached).toBe(false);
  });
});

describe('loadOpenApi: relative server URLs', () => {
  const doc = (servers?: unknown[]) =>
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      ...(servers && { servers }),
      paths: {
        '/a': {
          get: {
            servers: [{ url: '/op' }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
  const fetchOf = (text: string) =>
    (async () => new Response(text)) as unknown as typeof fetch;

  it('resolves them against where the spec came from', async () => {
    const url = 'https://api.test/v1/openapi.json';
    const model = await loadOpenApi(
      detectSpec(
        doc([
          { url: '/api/v3' },
          { url: 'https://x.test' },
          { url: '{host}/z' },
        ]),
        url,
      ),
      url,
      root,
      { fetch: fetchOf(doc()) },
    );
    expect(model.servers.map((s) => s.url)).toEqual([
      'https://api.test/api/v3',
      'https://x.test',
      '{host}/z',
    ]);
    expect(model.operations[0]!.servers?.[0]?.url).toBe('https://api.test/op');
  });

  it('falls back to the origin of the spec when it names no server', async () => {
    const url = 'https://api.test/v1/openapi.json';
    const model = await loadOpenApi(detectSpec(doc(), url), url, root, {
      fetch: fetchOf(doc()),
    });
    expect(model.servers).toEqual([{ url: 'https://api.test' }]);
  });

  it('leaves servers alone for a spec that is a file', async () => {
    const model = await loadOpenApi(
      detectSpec(doc([{ url: '/api' }]), 'a.json'),
      'a.json',
      root,
    );
    expect(model.servers.map((s) => s.url)).toEqual(['/api']);
    const abs = join(root, 'specs/a.json');
    await writeFile(abs, doc());
    expect(
      (await loadOpenApi(detectSpec(doc(), abs), abs, root)).servers,
    ).toEqual([]);
  });
});
