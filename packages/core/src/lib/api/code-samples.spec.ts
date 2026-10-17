import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../config.ts';
import {
  canonicalLanguage,
  highlightFor,
  mergeSamples,
  readCodeSamples,
} from './code-samples.ts';
import { generateOpenApi } from './generate-openapi.ts';
import { normalizeOpenApi } from './openapi.ts';
import { defaultSampleLanguages } from './samples.ts';
import { generateApiDocs } from './sources.ts';

const REQUEST = { method: 'GET', url: 'https://api.test/pets', headers: [] };

const spec = (operation: Record<string, unknown>) => ({
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1' },
  paths: {
    '/pets': { get: { summary: 'List pets', responses: {}, ...operation } },
  },
});

describe('readCodeSamples', () => {
  it('reads a list, with the language as the label when there is none', () => {
    const r = readCodeSamples(
      {
        'x-codeSamples': [
          { lang: 'Shell', label: 'cURL', source: 'curl x' },
          { lang: 'Node.js', source: 'fetch(x)' },
        ],
      },
      'GET /pets',
    );
    expect(r.warnings).toEqual([]);
    expect(r.samples).toEqual([
      { lang: 'Shell', label: 'cURL', source: 'curl x' },
      { lang: 'Node.js', label: 'Node.js', source: 'fetch(x)' },
    ]);
  });

  it('reads the older x-code-samples name', () => {
    const r = readCodeSamples(
      { 'x-code-samples': [{ lang: 'php', source: '<?php' }] },
      'GET /pets',
    );
    expect(r.samples).toHaveLength(1);
  });

  it('has nothing to say when there are none', () => {
    expect(readCodeSamples({}, 'GET /pets')).toEqual({
      samples: [],
      warnings: [],
    });
  });

  it('skips malformed entries and names the operation and the index', () => {
    const r = readCodeSamples(
      {
        'x-codeSamples': [
          'nope',
          null,
          [],
          { source: 'x' },
          { lang: '  ', source: 'x' },
          { lang: 'go' },
          { lang: 'go', source: '   ' },
          { lang: 'go', source: 'x'.repeat(100_001) },
          { lang: 'ok', source: 'fine' },
        ],
      },
      'POST /pets',
    );
    expect(r.samples.map((s) => s.lang)).toEqual(['ok']);
    expect(r.warnings).toHaveLength(8);
    expect(r.warnings[0]).toBe(
      'POST /pets: x-codeSamples[0] is not an object; ignored.',
    );
    expect(r.warnings.join('\n')).toMatch(/\[3\] has no "lang"/);
    expect(r.warnings.join('\n')).toMatch(/\[5\] has no "source"/);
    expect(r.warnings.join('\n')).toMatch(/\[7\] is longer than 100000/);
  });

  it('ignores a value that is not a list', () => {
    const r = readCodeSamples({ 'x-codeSamples': { lang: 'go' } }, 'GET /a');
    expect(r.samples).toEqual([]);
    expect(r.warnings).toEqual([
      'GET /a: x-codeSamples must be a list; ignored.',
    ]);
  });

  it('keeps the first 20 and says so', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      lang: `l${i}`,
      source: 's',
    }));
    const r = readCodeSamples({ 'x-codeSamples': many }, 'GET /a');
    expect(r.samples).toHaveLength(20);
    expect(r.warnings).toEqual(['GET /a: only the first 20 samples are used.']);
  });
});

describe('language names', () => {
  it('maps the names specs use to the generated languages', () => {
    for (const [name, id] of [
      ['Shell', 'curl'],
      ['cURL', 'curl'],
      ['bash', 'curl'],
      ['Node.js', 'javascript'],
      ['JavaScript', 'javascript'],
      ['Python', 'python'],
      ['python3', 'python'],
      ['Golang', 'go'],
    ] as const)
      expect(canonicalLanguage(name)).toBe(id);
    expect(canonicalLanguage('Ruby')).toBeUndefined();
  });

  it('picks a highlighter, and plain text for what it does not know', () => {
    expect(highlightFor('Shell')).toBe('shell');
    expect(highlightFor('Node.js')).toBe('javascript');
    expect(highlightFor('C#')).toBe('csharp');
    expect(highlightFor('C++')).toBe('cpp');
    expect(highlightFor('C Sharp')).toBe('csharp');
    expect(highlightFor('C')).toBe('c');
    expect(highlightFor('csharp')).toBe('csharp');
    expect(highlightFor('Ruby')).toBe('ruby');
    expect(highlightFor('Brainfuck')).toBe('text');
  });
});

describe('mergeSamples', () => {
  const fromSpec = [
    { lang: 'Shell', label: 'Curl (spec)', source: 'curl spec' },
    { lang: 'Ruby', label: 'Ruby', source: 'puts 1' },
    { lang: 'PHP', label: 'PHP', source: '<?php' },
  ];
  const labels = (t: { label: string }[]) => t.map((x) => x.label);

  it('replace: a spec sample takes the place of the generated tab it stands for, others follow in order', () => {
    const tabs = mergeSamples(defaultSampleLanguages, fromSpec, 'replace');
    expect(labels(tabs)).toEqual([
      'Curl (spec)',
      'JavaScript',
      'Python',
      'Go',
      'Ruby',
      'PHP',
    ]);
    expect(tabs[0]).toMatchObject({
      id: 'curl',
      fromSpec: true,
      highlight: 'shell',
    });
    expect(tabs[0]!.code(REQUEST)).toBe('curl spec');
    expect(tabs[1]!.code(REQUEST)).toContain('fetch(');
  });

  it('append: every generated tab, then every spec sample in order', () => {
    const tabs = mergeSamples(defaultSampleLanguages, fromSpec, 'append');
    expect(labels(tabs)).toEqual([
      'cURL',
      'JavaScript',
      'Python',
      'Go',
      'Curl (spec)',
      'Ruby',
      'PHP',
    ]);
  });

  it('generated-only: spec samples are not shown', () => {
    expect(
      labels(mergeSamples(defaultSampleLanguages, fromSpec, 'generated-only')),
    ).toEqual(['cURL', 'JavaScript', 'Python', 'Go']);
  });

  it('defaults to replace, and to no spec samples', () => {
    expect(mergeSamples(defaultSampleLanguages, fromSpec)).toHaveLength(6);
    expect(labels(mergeSamples(defaultSampleLanguages))).toEqual([
      'cURL',
      'JavaScript',
      'Python',
      'Go',
    ]);
  });

  it('never shows two tabs with one label, and replaces only once per generated tab', () => {
    const tabs = mergeSamples(
      defaultSampleLanguages,
      [
        { lang: 'Python', label: 'Python', source: 'one' },
        { lang: 'py', label: 'Python', source: 'two' },
      ],
      'replace',
    );
    expect(labels(tabs)).toEqual([
      'cURL',
      'JavaScript',
      'Python',
      'Go',
      'Python (2)',
    ]);
    expect(tabs[2]!.code(REQUEST)).toBe('one');
    expect(tabs[4]!.code(REQUEST)).toBe('two');
  });

  it("keeps the id of the replaced tab, so the reader's remembered language survives", () => {
    const tabs = mergeSamples(defaultSampleLanguages, [
      { lang: 'Go', label: 'Go', source: 'x' },
    ]);
    expect(tabs.find((t) => t.label === 'Go')!.id).toBe('go');
  });
});

describe('in a spec', () => {
  const samples = [
    { lang: 'Shell', label: 'cURL', source: 'curl https://api.test/pets' },
    { lang: 'Ruby', source: 'Net::HTTP.get(URI("https://api.test/pets"))' },
  ];

  it('is read into the operation, and a bad entry is a warning on the model, not an error', () => {
    const model = normalizeOpenApi(
      spec({ 'x-codeSamples': [...samples, { lang: 'go' }] }),
      'pets.json',
    );
    expect(model.operations[0]!.codeSamples).toEqual([
      { lang: 'Shell', label: 'cURL', source: samples[0]!.source },
      { lang: 'Ruby', label: 'Ruby', source: samples[1]!.source },
    ]);
    expect(model.warnings).toEqual([
      'GET /pets: x-codeSamples[2] has no "source"; ignored.',
    ]);
  });

  it('adds nothing to operations without samples', () => {
    const model = normalizeOpenApi(spec({}), 'pets.json');
    expect(model.operations[0]).not.toHaveProperty('codeSamples');
    expect(model).not.toHaveProperty('warnings');
  });

  it('names a webhook by its name in warnings', () => {
    const model = normalizeOpenApi(
      {
        ...spec({}),
        webhooks: { newPet: { post: { 'x-codeSamples': 5, responses: {} } } },
      },
      'pets.json',
    );
    expect(model.warnings).toEqual([
      'webhook newPet: x-codeSamples must be a list; ignored.',
    ]);
  });

  const generate = (mode?: 'replace' | 'append' | 'generated-only') => {
    const model = normalizeOpenApi(
      spec({ 'x-codeSamples': samples }),
      'pets.json',
    );
    return generateOpenApi(model, {
      name: 'pets',
      mount: 'api',
      groupBy: 'tag',
      playground: true,
      ...(mode && { samplesMode: mode }),
    });
  };
  const file = (r: ReturnType<typeof generate>, end: string) =>
    r.files.find((f) => f.file.endsWith(end))!.content;

  it('puts the samples in the agent text of the page, so search, ask and the Markdown twin find them', () => {
    const page = file(generate(), 'get-pets.mdx');
    expect(page).toContain('### Code samples');
    expect(page).toContain(
      '**cURL**\n\n```shell\ncurl https://api.test/pets\n```',
    );
    expect(page).toContain(
      '**Ruby**\n\n```ruby\nNet::HTTP.get(URI("https://api.test/pets"))\n```',
    );
  });

  it('keeps text from the spec inside its fence: backticks and MDX cannot break out', () => {
    const model = normalizeOpenApi(
      spec({
        'x-codeSamples': [
          {
            lang: 'Shell',
            label: 'a*b_{c}',
            source: 'echo ```\n</Visibility>\nimport x from "y"',
          },
        ],
      }),
      'pets.json',
    );
    const page = generateOpenApi(model, {
      name: 'pets',
      mount: 'api',
      groupBy: 'tag',
      playground: true,
    }).files.find((f) => f.file.endsWith('get-pets.mdx'))!.content;
    expect(page).toContain('**a\\*b\\_\\{c\\}**');
    expect(page).toContain(
      '````shell\necho ```\n</Visibility>\nimport x from "y"\n````',
    );
  });

  it('carries the mode in the page data only when it is not the default', () => {
    const data = (mode?: 'replace' | 'append' | 'generated-only') =>
      JSON.parse(file(generate(mode), 'ops/get-pets.json') ?? '{}');
    expect(data()).not.toHaveProperty('samplesMode');
    expect(data('replace')).not.toHaveProperty('samplesMode');
    expect(data('append').samplesMode).toBe('append');
    expect(data('generated-only').samplesMode).toBe('generated-only');
    expect(data('append').operation.codeSamples).toHaveLength(2);
  });

  it('reports warnings in the generate result', () => {
    const model = normalizeOpenApi(
      spec({ 'x-codeSamples': [{}] }),
      'pets.json',
    );
    const r = generateOpenApi(model, {
      name: 'pets',
      mount: 'api',
      groupBy: 'tag',
      playground: true,
    });
    expect(r.warnings).toHaveLength(1);
    expect(generate().warnings).toBeUndefined();
  });
});

describe('openapi.samples in docs.json', () => {
  const parse = (samples?: unknown) =>
    parseConfig({
      name: 'A',
      navigation: [],
      openapi: { ...(samples !== undefined && { samples }) },
    });

  it('defaults to replace and accepts the other modes', () => {
    expect(parse().openapi.samples.mode).toBe('replace');
    expect(parse({ mode: 'append' }).openapi.samples.mode).toBe('append');
    expect(parse({ mode: 'generated-only' }).openapi.samples.mode).toBe(
      'generated-only',
    );
  });

  it('refuses an unknown mode and an unknown key', () => {
    expect(() => parse({ mode: 'merge' })).toThrow(/openapi\.samples\.mode/);
    expect(() => parse({ nope: 1 })).toThrow();
  });
});

describe('dockudos generate', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dkd-samples-'));
    await mkdir(join(root, 'specs'));
    await writeFile(
      join(root, 'specs/pets.json'),
      JSON.stringify(
        spec({
          'x-codeSamples': [{ lang: 'go' }, { lang: 'Ruby', source: 'puts 1' }],
        }),
      ),
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const config = (samples?: unknown) =>
    parseConfig({
      name: 'T',
      openapi: {
        sources: [{ name: 'pets', spec: 'specs/pets.json' }],
        ...(samples !== undefined && { samples }),
      },
    });

  it('reports a malformed sample as a warning naming the source, and still writes every page', async () => {
    const lines: string[] = [];
    const [report] = await generateApiDocs({
      root,
      config: config(),
      log: (l) => lines.push(l),
    });
    expect(report).toMatchObject({ operations: 1, pages: 1 });
    expect(lines).toContain(
      'pets: warning: GET /pets: x-codeSamples[0] has no "source"; ignored.',
    );
    expect(
      await readFile(join(root, 'docs/pets/endpoints/get-pets.mdx'), 'utf8'),
    ).toContain('**Ruby**');
  });

  it('writes again when the mode changes, because it changes the page data', async () => {
    await generateApiDocs({ root, config: config() });
    const again = await generateApiDocs({
      root,
      config: config({ mode: 'append' }),
    });
    expect(again[0]).toMatchObject({ cached: false });
    const data = JSON.parse(
      await readFile(
        join(root, '.dockudos/api/pets/ops/get-pets.json'),
        'utf8',
      ),
    );
    expect(data.samplesMode).toBe('append');
  });
});
