import { mdxToMarkdown } from '@dockudos/core';
import { mdxComponents } from './components.tsx';

const convert = (body: string) =>
  mdxToMarkdown(body, { components: mdxComponents });

describe('every component has a Markdown twin', () => {
  // `pre`, `table` and `img` are HTML elements the Markdown already has.
  const named = Object.entries(mdxComponents).filter(([name]) =>
    /^[A-Z]/.test(name),
  );

  it.each(named)('%s has toMarkdown', (_name, component) => {
    expect(typeof (component as { toMarkdown?: unknown }).toMarkdown).toBe(
      'function',
    );
  });

  it('also on the parts that hang off a component', () => {
    expect(typeof mdxComponents.Tree.Folder.toMarkdown).toBe('function');
    expect(typeof mdxComponents.Tree.File.toMarkdown).toBe('function');
  });
});

describe('components as Markdown', () => {
  it('callouts become quotes', async () => {
    expect(
      await convert(
        '<Callout type="warning" title="Careful">Do not.</Callout>',
      ),
    ).toBe('> **Warning: Careful**\n>\n> Do not.');
    expect(await convert('<Tip>A shortcut.</Tip>')).toBe(
      '> **Tip:** A shortcut.',
    );
    expect(await convert('<Callout>Plain.</Callout>')).toBe(
      '> **Note:** Plain.',
    );
  });

  it('tabs and steps become headed lines, steps numbered', async () => {
    expect(
      await convert(
        '<Tabs>\n<Tab value="npm">\nnpm i\n</Tab>\n<Tab value="pnpm">\npnpm add\n</Tab>\n</Tabs>',
      ),
    ).toBe('**npm**\n\nnpm i\n\n**pnpm**\n\npnpm add');
    expect(
      await convert(
        '<Steps>\n<Step title="Install">\nDo it.\n</Step>\n<Step title="Run">\nGo.\n</Step>\n</Steps>',
      ),
    ).toBe('**1. Install**\n\nDo it.\n\n**2. Run**\n\nGo.');
  });

  it('cards are links, keys and shortcuts code, endpoints method and path', async () => {
    expect(
      await convert(
        '<Cards>\n<Card title="Start" href="/start">\nBegin.\n</Card>\n<Card title="Info">Text.</Card>\n</Cards>',
      ),
    ).toBe('**[Start](/start)**\n\nBegin.\n\n**Info**\n\nText.');
    expect(await convert('Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>.')).toBe(
      'Press `Ctrl` + `K`.',
    );
    expect(await convert('<Endpoint method="get" path="/pet/{id}" />')).toBe(
      '`GET /pet/{id}`',
    );
    expect(
      await convert(
        '<ParamField name="id" type="string" required>The id.</ParamField>',
      ),
    ).toBe('**`id`** (string, required)\n\nThe id.');
  });

  it('a type table is a table, colors are a table, a tree is a list', async () => {
    expect(
      await convert(
        "<TypeTable type={{ name: { type: 'string', required: true, description: 'The name.' }, limit: { type: 'number', default: '10' } }} />",
      ),
    ).toBe(
      '| Name | Type | Default | Description |\n| --- | --- | --- | --- |\n| `name` (required) | `string` |  | The name. |\n| `limit` | `number` | `10` |  |',
    );
    expect(
      await convert(
        "<Colors title=\"Brand\" items={[{ name: 'Ink', value: '#111' }]} />",
      ),
    ).toBe('**Brand**\n\n| Name | Value |\n| --- | --- |\n| Ink | `#111` |');
    expect(
      await convert(
        '<Tree>\n  <Tree.Folder name="src">\n    <Tree.File name="index.ts" />\n  </Tree.Folder>\n  <Tree.File name="package.json" />\n</Tree>',
      ),
    ).toBe('- src/\n  - index.ts\n- package.json');
  });

  it('a quiz keeps its answers and marks the right one', async () => {
    expect(
      await convert(
        '<Quiz title="Check">\n<Question text="Pick one">\n<Answer>A</Answer>\n<Answer correct>B</Answer>\n</Question>\n</Quiz>',
      ),
    ).toBe('**Quiz: Check**\n\n**Pick one**\n\n- A\n- B (correct)');
  });

  it('a mermaid chart stays a fence', async () => {
    expect(await convert('<Mermaid chart={`graph TD\n  A --> B`} />')).toBe(
      '```mermaid\ngraph TD\n  A --> B\n```',
    );
  });

  it('API sections add nothing: the generated page carries the operation as Markdown', async () => {
    expect(
      await convert(
        '<ApiOperation data={{ a: 1 }}>\n<ApiParameters />\n<ApiPlayground />\n</ApiOperation>',
      ),
    ).toBe('');
  });

  it('an inline table of contents lists the headings of the page', async () => {
    expect(await convert('<InlineToc />\n\n## One\n\n### Two')).toContain(
      '- [One](#one)\n  - [Two](#two)',
    );
  });
});
