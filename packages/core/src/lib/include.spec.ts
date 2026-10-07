import { expandIncludes, IncludeError } from './include.ts';

const run = (files: Record<string, string>, file = 'index.mdx') =>
  expandIncludes(files[file] as string, {
    file,
    read: (f) => {
      if (!(f in files)) throw new Error('ENOENT');
      return files[f] as string;
    },
  });

describe('expandIncludes', () => {
  it('inlines a file and strips its frontmatter', async () => {
    const out = await run({
      'index.mdx': 'before\n<include>./snip.mdx</include>\nafter',
      'snip.mdx': '---\ntitle: S\n---\nshared',
    });
    expect(out).toBe('before\nshared\nafter');
  });

  it('resolves relative to the including file and supports nesting', async () => {
    const out = await run({
      'index.mdx': '<include>./a/one.mdx</include>',
      'a/one.mdx': 'one\n<include>../two.mdx</include>',
      'two.mdx': 'two\n<include>/c/three.mdx</include>',
      'c/three.mdx': 'three',
    });
    expect(out).toBe('one\ntwo\nthree');
  });

  it('allows the same file twice when it is not a cycle', async () => {
    const out = await run({
      'index.mdx': '<include>./s.mdx</include>\n<include>./s.mdx</include>',
      's.mdx': 'x',
    });
    expect(out).toBe('x\nx');
  });

  it('ignores includes inside code fences', async () => {
    const src = '```mdx\n<include>./s.mdx</include>\n```';
    expect(await run({ 'index.mdx': src, 's.mdx': 'x' })).toBe(src);
  });

  it('ignores includes inside an indented fence', async () => {
    const src =
      '<Step>\n    ```mdx\n    <include>./s.mdx</include>\n    ```\n</Step>';
    expect(await run({ 'index.mdx': src, 's.mdx': 'x' })).toBe(src);
  });

  it('names file and line for a missing file', async () => {
    const err = await run({
      'index.mdx': 'a\nb\n<include>./gone.mdx</include>',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IncludeError);
    expect(err.message).toBe('index.mdx:3: included file not found: gone.mdx');
  });

  it('detects a cycle and shows the path', async () => {
    const err = await run({
      'index.mdx': '<include>./a.mdx</include>',
      'a.mdx': 'x\n<include>./b.mdx</include>',
      'b.mdx': '<include>./a.mdx</include>',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IncludeError);
    expect(err.message).toContain(
      'include cycle: index.mdx -> a.mdx -> b.mdx -> a.mdx',
    );
    expect(err.file).toBe('b.mdx');
  });

  it('detects a file that includes itself', async () => {
    await expect(
      run({ 'index.mdx': '<include>./index.mdx</include>' }),
    ).rejects.toThrow(/cycle/);
  });

  it('leaves inline mentions of <include> alone', async () => {
    const src = 'Use <include>x</include> in a sentence.';
    expect(await run({ 'index.mdx': src })).toBe(src);
  });
});
