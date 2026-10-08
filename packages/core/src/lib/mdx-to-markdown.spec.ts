import { type ToMarkdown, md } from './markdown-twin.ts';
import { mdxToMarkdown } from './mdx-to-markdown.ts';

// Components as a site defines them: a function with a `toMarkdown` attached.
const Note = Object.assign(() => null, {
  toMarkdown: ((props, children) =>
    md.quote('Note', md.text(props.title), children)) satisfies ToMarkdown<{
    title?: string;
  }>,
});
const Steps = Object.assign(() => null, { toMarkdown: md.container });
const Step = Object.assign(() => null, {
  toMarkdown: ((props, children, { index }) =>
    md.section(
      md.bold(`${index + 1}. ${String(props.title)}`),
      children,
    )) satisfies ToMarkdown<{ title?: string }>,
});
const Kbd = Object.assign(() => null, {
  toMarkdown: ((_p, children) => md.code(children.trim())) satisfies ToMarkdown,
});
const Table = Object.assign(() => null, {
  toMarkdown: ((props) => {
    const rows = props.rows;
    if (!Array.isArray(rows)) return undefined;
    return md.block(md.table(['A', 'B'], rows as unknown[][]));
  }) satisfies ToMarkdown<{ rows?: unknown[][] }>,
});
const Tree = Object.assign(() => null, {
  toMarkdown: md.container,
  Folder: Object.assign(() => null, {
    toMarkdown: ((props, children, { parents }) =>
      `${md.item(`${String(props.name)}/`, parents.filter((p) => p === 'Tree.Folder').length)}\n${md.trimBlank(children)}`) satisfies ToMarkdown<{
      name: string;
    }>,
  }),
});
const Diagram = Object.assign(() => null, {
  toMarkdown: ((props, _c, { fence }) =>
    fence(
      `\`\`\`mermaid\n${String(props.chart)}\n\`\`\``,
    )) satisfies ToMarkdown<{ chart: string }>,
});
const components = { Note, Steps, Step, Kbd, Table, Tree, Diagram };
const convert = (body: string) => mdxToMarkdown(body, { components });

describe('mdxToMarkdown', () => {
  it('asks each component to write itself, with its props and its converted content', async () => {
    expect(
      await convert('<Note title="Careful">\nDo not.\n\nReally.\n</Note>'),
    ).toBe('> **Note: Careful**\n>\n> Do not.\n>\n> Really.');
    expect(await convert('<Note>A line.</Note>')).toBe('> **Note:** A line.');
  });

  it('converts nested components first, so a component inside another is written too', async () => {
    expect(await convert('<Note>Press <Kbd>Ctrl</Kbd> to start.</Note>')).toBe(
      '> **Note:** Press `Ctrl` to start.',
    );
    expect(
      await convert('<Note title="Outer">\n<Note>Inner.</Note>\n</Note>'),
    ).toBe('> **Note: Outer**\n>\n> > **Note:** Inner.');
  });

  it('tells a component where it sits: its place among siblings and what it is inside', async () => {
    const out = await convert(
      '<Steps>\n  <Step title="Install">\n    Do it.\n  </Step>\n  <Step title="Run">\n    Go.\n  </Step>\n</Steps>',
    );
    expect(out).toBe('**1. Install**\n\nDo it.\n\n**2. Run**\n\nGo.');
    expect(
      await convert(
        '<Tree>\n<Tree.Folder name="src">\n<Tree.Folder name="lib">\n</Tree.Folder>\n</Tree.Folder>\n</Tree>',
      ),
    ).toBe('- src/\n  - lib/');
  });

  it('finds a component by a dotted name, and keeps the tag when the component cannot write what it was given', async () => {
    expect(await convert('<Tree.Folder name="a" />')).toBe('- a/');
    expect(await convert('<Table rows={[["x", "y"]]} />')).toContain(
      '| x | y |',
    );
    expect(await convert('<Table rows={makeRows()} />')).toBe(
      '<Table rows={makeRows()} />',
    );
  });

  it('keeps the content, and the title, of a component that has no toMarkdown', async () => {
    expect(await convert('<Mine title="Heads up">\nInside.\n</Mine>')).toBe(
      '**Heads up**\n\nInside.',
    );
    expect(await convert('<Mine>Just text.</Mine> and more')).toBe(
      'Just text. and more',
    );
    expect(await convert('<Mine variant={fn} />')).toBe('');
  });

  it('never touches code, plain HTML or generics', async () => {
    const md2 =
      'Use `Array<string>` and `<Note>` here.\n\n<details>\n<summary>More</summary>\n\nText\n\n</details>\n\n```tsx\n<Note title="x">y</Note>\n```';
    expect(await convert(md2)).toBe(md2);
  });

  it('keeps a code fence inside a quote, with the quote prefix', async () => {
    expect(
      await convert(
        '<Note>\nRun:\n\n```bash\n<Kbd> is not a tag here\n```\n</Note>',
      ),
    ).toBe('> **Note:** Run:\n>\n> ```bash\n> <Kbd> is not a tag here\n> ```');
  });

  it('lets a component write a fence that is not converted again', async () => {
    expect(await convert('<Diagram chart="graph TD; A-->B" />')).toBe(
      '```mermaid\ngraph TD; A-->B\n```',
    );
  });

  it('reads props that hold braces and strings with braces', async () => {
    expect(
      await convert('<Table rows={[["a}b", "{c"], ["d", `e`]]} />'),
    ).toContain('| a}b | {c |');
  });

  it('takes the indentation off content that sat inside a tag, but not a list inside it', async () => {
    expect(
      await convert(
        '<Steps>\n  <Step title="Run">\n    Do it:\n\n    ```bash\n    npm run build\n    ```\n  </Step>\n</Steps>',
      ),
    ).toBe('**1. Run**\n\nDo it:\n\n```bash\nnpm run build\n```');
    expect(
      await convert(
        '<Steps>\n  <Step title="Pick">\n    - one\n      more\n    - two\n  </Step>\n</Steps>',
      ),
    ).toBe('**1. Pick**\n\n- one\n  more\n- two');
  });

  it('drops imports, comments and a closing tag with nothing to close', async () => {
    expect(
      await convert("import { X } from 'y';\n\n{/* note */}\ntext</Kbd> more"),
    ).toBe('text more');
  });
});
