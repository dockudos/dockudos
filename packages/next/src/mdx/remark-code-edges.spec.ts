import { compile } from '@mdx-js/mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fromMarkdown = (md: string) => unified().use(remarkParse).parse(md);

const compileWith = async (plugin: unknown, source: string) =>
  String(
    await compile(
      { value: source, path: '/tmp/docs/page.mdx' },
      { jsx: true, remarkPlugins: [plugin] as never },
    ),
  );

afterEach(() => {
  vi.doUnmock('typescript');
  vi.resetModules();
});

describe('ts-to-js', () => {
  it('explains how to fix it when the typescript package is not installed', async () => {
    vi.resetModules();
    vi.doMock('typescript', () => {
      throw new Error('Cannot find module typescript');
    });
    const { default: remarkCode } = await import('./remark-code.ts');
    await expect(
      compileWith(remarkCode, '```ts ts-to-js\nconst a: number = 1;\n```'),
    ).rejects.toThrow(/`ts-to-js` code blocks need the `typescript` package/);
  });

  it('keeps the rest of the meta on both code blocks and removes only the flag', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const tree = fromMarkdown(
      '```ts title="a.ts" ts-to-js\nconst a: number = 1;\n```',
    );
    await (remarkCode as unknown as () => (t: unknown) => Promise<void>)()(
      tree,
    );
    const blocks: { lang: string; meta: string | null; value: string }[] = [];
    const walk = (n: any): void => {
      if (n.type === 'code') blocks.push(n);
      (n.children ?? []).forEach(walk);
    };
    walk(tree);
    expect(blocks.map((b) => b.lang)).toEqual(['ts', 'js']);
    for (const b of blocks) expect(b.meta).toBe('title="a.ts"');
    expect(blocks[0]!.value).toContain(': number');
    expect(blocks[1]!.value).not.toContain(': number');
  });

  it('has no meta left when the flag was the only thing', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const tree = fromMarkdown('```ts ts-to-js\nconst a: number = 1;\n```');
    await (remarkCode as unknown as () => (t: unknown) => Promise<void>)()(
      tree,
    );
    const metas: unknown[] = [];
    const walk = (n: any): void => {
      if (n.type === 'code') metas.push(n.meta);
      (n.children ?? []).forEach(walk);
    };
    walk(tree);
    expect(metas).toEqual([null, null]);
  });

  it('turns tsx into jsx for the JavaScript tab', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const out = await compileWith(
      remarkCode,
      '```tsx ts-to-js\nexport const A = (p: { x: number }) => <b>{p.x}</b>;\n```',
    );
    expect(out).toContain('jsx');
    expect(out).toContain('tsx');
  });

  it('leaves a typescript block without the flag, and the flag on another language, alone', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const plain = await compileWith(
      remarkCode,
      '```ts\nconst a: number = 1;\n```',
    );
    expect(plain).not.toContain('Tab');
    const other = await compileWith(
      remarkCode,
      '```python ts-to-js\nprint(1)\n```',
    );
    expect(other).not.toContain('JavaScript');
  });
});

describe('other fenced blocks', () => {
  it('turns mermaid into a diagram with the source as its chart', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const out = await compileWith(
      remarkCode,
      '```mermaid\ngraph TD; A-->B\n```',
    );
    expect(out).toContain('Mermaid');
    expect(out).toContain('graph TD; A-->B');
  });

  it('gives a package-install block a tab per package manager, ignoring blank lines', async () => {
    const { default: remarkCode } = await import('./remark-code.ts');
    const out = await compileWith(
      remarkCode,
      '```package-install\nnpm install foo\n\nnpm install -D bar\n```',
    );
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) expect(out).toContain(pm);
    expect(out).toContain('pnpm add foo');
    expect(out).toContain('pnpm add -D bar');
  });
});
