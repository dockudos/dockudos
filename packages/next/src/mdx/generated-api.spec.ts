import { compile } from '@mdx-js/mdx';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { extractPage, resolveVisibility } from '@dockudos/core';
import {
  detectSpec,
  generateAsyncApi,
  generateGraphql,
  generateOpenApi,
  generatePython,
  generateTypeScript,
  loadOpenApi,
  normalizeAsyncApi,
  parseSpecText,
  readGraphqlSchema,
} from '@dockudos/core/node';

const fixtures = join(
  import.meta.dirname,
  '../../../core/src/lib/api/fixtures',
);

/** Text from a spec that would break MDX if it were pasted in as it is. */
const NASTY = [
  'Uses {braces} and <tags> and <!-- comments -->',
  'import x from "y"',
  'export const a = 1',
  '{/* not a comment */}',
  '| a | b |\n| - | - |',
  '</div> <Unclosed',
  '```\nunbalanced fence',
  '# Heading\n\n- item\n\n1) other',
  'a ${template} `tick` \\ backslash',
].join('\n\n');

const hostile = {
  openapi: '3.1.0',
  info: { title: 'Hostile {x} <y>', version: '1', description: NASTY },
  tags: [{ name: 'Tag {a} <b>', description: NASTY }],
  servers: [
    {
      url: 'https://api.test/{v}',
      description: NASTY,
      variables: { v: { default: '1' } },
    },
  ],
  paths: {
    '/a/{id}': {
      get: {
        operationId: 'x',
        summary: 'Summary {with} <markup>',
        description: NASTY,
        tags: ['Tag {a} <b>'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: NASTY,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          description: NASTY,
          content: {
            'application/json': {
              schema: { type: 'object', description: NASTY },
            },
          },
        },
        responses: {
          '200': {
            description: NASTY,
            content: {
              'text/plain': { schema: { type: 'string' }, example: 'a`b```c' },
            },
          },
        },
      },
    },
  },
};

const compileAll = async (spec: unknown, name: string) => {
  const location = `${name}.json`;
  const model = await loadOpenApi(
    detectSpec(JSON.stringify(spec), location),
    location,
    '/',
  );
  const { files } = generateOpenApi(model, {
    name,
    mount: 'api',
    groupBy: 'tag',
    playground: true,
  });
  const pages = files.filter((f) => f.file.endsWith('.mdx'));
  for (const page of pages) {
    await compile(
      { value: page.content, path: page.file },
      { jsx: true, remarkPlugins: [remarkFrontmatter, remarkGfm] },
    );
  }
  return pages;
};

describe('generated API pages', () => {
  it('compile as MDX whatever text the spec contains', async () => {
    const pages = await compileAll(hostile, 'hostile');
    expect(pages.length).toBe(2);
  });

  it('compile for the composed and real fixtures', async () => {
    for (const name of [
      'petstore.json',
      'composed-31.yaml',
      'legacy-30.json',
    ]) {
      const text = await readFile(join(fixtures, name), 'utf8');
      const location = join(fixtures, name);
      const model = await loadOpenApi(
        detectSpec(text, location),
        location,
        fixtures,
      );
      const { files } = generateOpenApi(model, {
        name: 'f',
        mount: 'api',
        groupBy: 'tag',
        playground: true,
        proxy: true,
      });
      for (const page of files.filter((f) => f.file.endsWith('.mdx'))) {
        await compile(
          { value: page.content, path: page.file },
          { jsx: true, remarkPlugins: [remarkFrontmatter, remarkGfm] },
        );
      }
    }
  });

  it('give search the method, path and summary, and agents the whole endpoint', async () => {
    const text = await readFile(join(fixtures, 'petstore.json'), 'utf8');
    const location = join(fixtures, 'petstore.json');
    const model = await loadOpenApi(
      detectSpec(text, location),
      location,
      fixtures,
    );
    const { files } = generateOpenApi(model, {
      name: 'p',
      mount: 'api',
      groupBy: 'tag',
      playground: true,
    });
    const page = files.find((f) => f.file.endsWith('pet/getpetbyid.mdx'));
    const body = (page?.content ?? '').replace(/^---[\s\S]*?---\n/, '');
    // What a person sees is indexed: the endpoint line carries method and path.
    const human = resolveVisibility(body, 'humans');
    expect(
      extractPage(human)
        .sections.map((s) => s.text)
        .join(' '),
    ).toContain('/pet/{petId}');
    expect(resolveVisibility(body, 'agents')).toContain('### Responses');
  });

  it('AsyncAPI, GraphQL, TypeScript and Python pages compile too', async () => {
    const all: { file: string; content: string }[] = [];
    for (const name of ['chat-2.yaml', 'orders-3.yaml']) {
      const model = normalizeAsyncApi(
        parseSpecText(await readFile(join(fixtures, name), 'utf8'), name),
        name,
      );
      all.push(...generateAsyncApi(model, { name: 'e', mount: 'e' }).files);
    }
    all.push(
      ...generateGraphql(
        readGraphqlSchema(
          { text: await readFile(join(fixtures, 'shop.graphql'), 'utf8') },
          's',
        ),
        { name: 'g', mount: 'g' },
      ).files,
    );
    all.push(
      ...(
        await generateTypeScript([join(fixtures, 'sdk.ts')], fixtures, {
          name: 't',
          base: 'docs/t',
        })
      ).files,
    );
    all.push(
      ...generatePython(
        await readFile(join(fixtures, 'shop-griffe.json'), 'utf8'),
        'g.json',
        { name: 'p', base: 'docs/p' },
      ).files,
    );
    expect(all.length).toBeGreaterThan(20);
    for (const page of all) {
      await compile(
        { value: page.content, path: page.file },
        { jsx: true, remarkPlugins: [remarkFrontmatter, remarkGfm] },
      );
    }
  });
});
