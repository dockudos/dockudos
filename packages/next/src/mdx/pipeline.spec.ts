import { compile } from '@mdx-js/mdx';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { extractToc } from '@dockudos/core';
import remarkAdmonitions from './remark-admonitions.ts';
import remarkInclude from './remark-include.ts';
import remarkLinks from './remark-links.ts';

let docsDir: string;
beforeEach(async () => {
  docsDir = await mkdtemp(join(tmpdir(), 'dockudos-mdx-'));
  await mkdir(join(docsDir, 'guides'), { recursive: true });
});
afterEach(() => rm(docsDir, { recursive: true, force: true }));

async function render(source: string, file = 'guides/page.mdx') {
  const out = await compile(
    { value: source, path: join(docsDir, file) },
    {
      jsx: true,
      remarkPlugins: [
        remarkFrontmatter,
        remarkGfm,
        remarkDirective,
        [remarkInclude, { docsDir }],
        remarkAdmonitions,
        [remarkLinks, { docsDir }],
      ],
      rehypePlugins: [rehypeSlug],
    },
  );
  return String(out);
}

/** The string literals MDX emits for text nodes, joined. */
const visibleText = (out: string) =>
  [...out.matchAll(/\{("(?:[^"\\]|\\.)*")\}/g)]
    .map((m) => JSON.parse(m[1] as string))
    .join('');

describe('admonitions', () => {
  it('turns :::note blocks into Callout', async () => {
    const out = await render(':::warning[Careful]\nDo **not** do this.\n:::\n');
    expect(out).toContain('<Callout type="warning" title="Careful">');
    expect(out).toContain('<_components.strong>{"not"}</_components.strong>');
  });

  it('works without a title and with several paragraphs and code', async () => {
    const out = await render(':::tip\nOne\n\n```js\nx\n```\n\nTwo\n:::\n');
    expect(out).toContain('<Callout type="tip">');
    expect(visibleText(out)).toContain('Two');
  });

  it('leaves unknown containers and ordinary colons alone', async () => {
    const out = await render('Meet at 10:30, see std::vector and :smile.\n');
    expect(visibleText(out)).toBe('Meet at 10:30, see std::vector and :smile.');
  });
});

describe('links', () => {
  it('rewrites relative page links to site paths and keeps external ones', async () => {
    const out = await render(
      '[a](./other.mdx#x) [b](https://x.dev/a.mdx) [c](#top)',
    );
    expect(out).toContain('href="/guides/other#x"');
    expect(out).toContain('href="https://x.dev/a.mdx"');
    expect(out).toContain('href="#top"');
  });
});

describe('headings', () => {
  it('gives headings the ids that extractToc predicts', async () => {
    const source =
      '# T\n## Getting started\n### Install `pnpm`\n## Getting started\n#### A *b* [c](d) snake_case\n';
    const out = await render(source);
    for (const { id } of extractToc(source, { minDepth: 1 })) {
      expect(out).toContain(`id="${id}"`);
    }
  });
});

describe('include', () => {
  it('inlines another file, frontmatter and all', async () => {
    await writeFile(
      join(docsDir, 'snip.mdx'),
      '---\ntitle: S\n---\nShared **text**\n',
    );
    const out = await render(
      'Before\n\n<include>../snip.mdx</include>\n\nAfter',
    );
    expect(visibleText(out)).toBe('Before\nShared text\nAfter');
    expect(out).not.toContain('title: S');
  });

  it('supports nesting', async () => {
    await writeFile(
      join(docsDir, 'a.mdx'),
      'A\n\n<include>./b.mdx</include>\n',
    );
    await writeFile(join(docsDir, 'b.mdx'), 'BEE\n');
    expect(visibleText(await render('<include>/a.mdx</include>'))).toBe(
      'A\nBEE',
    );
  });

  it('fails on a cycle with the chain', async () => {
    await writeFile(join(docsDir, 'a.mdx'), '<include>./b.mdx</include>\n');
    await writeFile(join(docsDir, 'b.mdx'), '<include>./a.mdx</include>\n');
    await expect(render('<include>/a.mdx</include>')).rejects.toThrow(
      /include cycle: guides\/page\.mdx -> a\.mdx -> b\.mdx -> a\.mdx/,
    );
  });

  it('fails on a missing file with file and line', async () => {
    await expect(render('x\n\n<include>./nope.mdx</include>')).rejects.toThrow(
      /guides\/page\.mdx:3: included file not found: guides\/nope\.mdx/,
    );
  });
});
