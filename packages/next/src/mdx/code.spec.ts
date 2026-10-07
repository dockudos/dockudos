import { compile } from '@mdx-js/mdx';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import rehypeCode from './rehype-code.ts';
import remarkCode from './remark-code.ts';
import remarkImages from './remark-images.ts';
import remarkMathStyles from './remark-math-styles.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-code-'));
  await mkdir(join(dir, 'public'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const compileMdx = async (
  source: string,
  extra: { remark?: unknown[]; rehype?: unknown[] } = {},
) =>
  String(
    await compile(
      { value: source, path: join(dir, 'docs', 'page.mdx') },
      {
        jsx: true,
        remarkPlugins: [remarkCode, ...(extra.remark ?? [])] as never,
        rehypePlugins: [
          [rehypeCode, { twoslash: false }],
          ...(extra.rehype ?? []),
        ] as never,
      },
    ),
  );

describe('rehype-code', () => {
  it('highlights with light and dark themes through CSS variables', async () => {
    const out = await compileMdx('```ts\nconst a: number = 1;\n```');
    expect(out).toContain('--shiki-light');
    expect(out).toContain('--shiki-dark');
    expect(out).toContain('data-language="ts"');
  });

  it('reads title, line highlight and line numbers from the fence meta', async () => {
    const out = await compileMdx(
      '```ts title="hello.ts" {2} showLineNumbers\na\nb\nc\n```',
    );
    expect(out).toContain('data-title="hello.ts"');
    expect(out).toContain('data-line-numbers');
    expect(out.match(/highlighted/g)).toHaveLength(1);
  });

  it('supports comment notations for highlight and diff', async () => {
    const out = await compileMdx(
      '```ts\nconst a = 1; // [!code highlight]\nconst b = 2; // [!code ++]\nconst c = 3; // [!code --]\n```',
    );
    expect(out).toContain('highlighted');
    expect(out).toContain('add');
    expect(out).toContain('remove');
    expect(out).not.toContain('[!code');
  });

  it('does not fail on an unknown language', async () => {
    await expect(compileMdx('```nonsense-lang\nhello\n```')).resolves.toContain(
      'hello',
    );
  });
});

describe('twoslash', () => {
  it('adds type information to fences marked twoslash and leaves others alone', async () => {
    const out = String(
      await compile(
        {
          value:
            '```ts twoslash\nconst point = { x: 1 };\nconst n = point.x;\n```\n\n```ts\nconst plain = 1;\n```',
          path: join(dir, 'p.mdx'),
        },
        { jsx: true, rehypePlugins: [rehypeCode] as never },
      ),
    );
    expect(out).toContain('twoslash');
    expect(out).toContain('twoslash-popup');
    expect(out.match(/twoslash-popup-container/g)!.length).toBeGreaterThan(0);
  }, 30_000);
});

describe('package-install', () => {
  it('becomes npm, pnpm, yarn and bun tabs', async () => {
    const out = await compileMdx(
      '```package-install\nnpm install @dockudos/core -D\n```',
    );
    expect(out).toContain('groupId="package-manager"');
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun'])
      expect(out).toContain(`value="${pm}"`);
    expect(out).toContain('add');
    expect(out.replace(/<[^>]+>|\{"|"\}/g, '')).toContain('pnpm');
  });
});

describe('ts-to-js', () => {
  it('shows TypeScript and the JavaScript with types removed', async () => {
    const out = await compileMdx(
      '```ts ts-to-js\ninterface U { name: string }\nexport function hi(u: U): string {\n  return u.name;\n}\n```',
    );
    expect(out).toContain('value="TypeScript"');
    expect(out).toContain('value="JavaScript"');
    expect(out).toContain('groupId="language"');
    // The JavaScript pane has no `interface` and no annotations.
    const js = out.slice(out.indexOf('value="JavaScript"'));
    expect(js).not.toContain('interface');
    expect(js).not.toMatch(/: string/);
    expect(js).toContain('hi');
  });
});

describe('mermaid', () => {
  it('becomes a Mermaid component carrying the source', async () => {
    const out = await compileMdx('```mermaid\ngraph LR\n  A --> B\n```');
    expect(out).toContain('<Mermaid chart=');
    expect(out).toContain('A --> B');
  });
});

describe('math', () => {
  const plugins = {
    remark: [
      [remarkMath, { singleDollarTextMath: false }],
      [remarkMathStyles, { css: '@dockudos/next/katex.css' }],
    ],
    rehype: [rehypeKatex],
  };

  it('renders math with KaTeX and loads its stylesheet', async () => {
    const out = await compileMdx(
      'Inline $$E = mc^2$$.\n\n$$\n\\int_0^1 x\\,dx\n$$',
      plugins,
    );
    expect(out).toContain('katex');
    expect(out).toContain('import "@dockudos/next/katex.css"');
  });

  it('does not load the stylesheet on pages without math', async () => {
    const out = await compileMdx(
      'No math here, just $5 and $10 prices.',
      plugins,
    );
    expect(out).not.toContain('katex.css');
  });
});

describe('images', () => {
  const plugins = (publicDir = join(dir, 'public')) => ({
    remark: [[remarkImages, { publicDir }]],
  });
  // A 3x2 PNG.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP8z8Dwn4GBgQEAFAAC/q7QqQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('turns a relative image into an import so it gets its real size', async () => {
    const out = await compileMdx('![Alt text](./pic.png "Title")', plugins());
    expect(out).toContain('import __dockudosImage0 from "./pic.png"');
    expect(out).toContain('src={__dockudosImage0}');
    expect(out).toContain('alt="Alt text"');
  });

  it('reads width and height of a public image', async () => {
    await writeFile(join(dir, 'public', 'p.png'), PNG);
    const out = await compileMdx('![x](/p.png)', plugins());
    expect(out).toContain('width="3"');
    expect(out).toContain('height="2"');
  });

  it('leaves remote and missing images alone', async () => {
    const out = await compileMdx(
      '![r](https://x.dev/a.png) ![m](/missing.png)',
      plugins(),
    );
    expect(out).toContain('https://x.dev/a.png');
    expect(out).not.toContain('width=');
    expect(out).not.toContain('import ');
  });

  it('does not read files outside public/', async () => {
    await writeFile(join(dir, 'secret.png'), PNG);
    const out = await compileMdx('![x](/../secret.png)', plugins());
    expect(out).not.toContain('width=');
  });

  it('survives a corrupt public image', async () => {
    await writeFile(join(dir, 'public', 'bad.png'), 'not an image');
    await expect(compileMdx('![x](/bad.png)', plugins())).resolves.toContain(
      '/bad.png',
    );
  });
});
