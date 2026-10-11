import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mdxToMarkdown } from '@dockudos/core';
import { readTypeFields } from './auto-type-table.tsx';
import { defineMdxComponents } from './mdx-components.ts';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-types-'));
  file = join(dir, 'types.ts');
  await writeFile(
    file,
    `export interface Options {
  /** Name shown in the navbar. */
  name: string;
  /**
   * How many items to show.
   * @default 10
   */
  limit?: number;
  mode: 'a' | 'b';
  callback?: (id: string) => void;
}
export type Alias = { x: boolean };
export const notAType = 1;
`,
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('readTypeFields', () => {
  it('reads types, required flags, descriptions and defaults from an interface', async () => {
    expect(await readTypeFields(file, 'Options')).toEqual({
      name: {
        type: 'string',
        required: true,
        description: 'Name shown in the navbar.',
      },
      limit: {
        type: 'number',
        required: false,
        description: 'How many items to show.',
        default: '10',
      },
      mode: { type: '"a" | "b"', required: true },
      callback: { type: '(id: string) => void', required: false },
    });
  });

  it('reads a type alias to an object type', async () => {
    expect(await readTypeFields(file, 'Alias')).toEqual({
      x: { type: 'boolean', required: true },
    });
  });

  it('names the missing type and the file', async () => {
    await expect(readTypeFields(file, 'Nope')).rejects.toThrow(
      /no interface or type named "Nope"/,
    );
    await expect(readTypeFields(file, 'notAType')).rejects.toThrow(/notAType/);
  });
});

describe('defineMdxComponents', () => {
  it('adds AutoTypeTable to the built-ins and lets the user override any component by name', () => {
    const Mine = () => null;
    const map = defineMdxComponents({ Callout: Mine });
    expect(map['Callout']).toBe(Mine);
    expect(map['AutoTypeTable']).toBeTypeOf('function');
    expect(map['Tabs']).toBeTypeOf('function');
  });
});

describe('AutoTypeTable as Markdown', () => {
  it('reads the types now and writes them as a table', async () => {
    const out = await mdxToMarkdown(
      `<AutoTypeTable path="${file}" name="Options" />`,
      { components: defineMdxComponents() },
    );
    expect(out).toContain(
      '| `name` (required) | `string` |  | Name shown in the navbar. |',
    );
    expect(out).toContain(
      '| `limit` | `number` | `10` | How many items to show. |',
    );
  });

  it('names the table in a line when the file cannot be read', async () => {
    const out = await mdxToMarkdown(
      '<AutoTypeTable path="/no/such.ts" name="Options" />',
      { components: defineMdxComponents() },
    );
    expect(out).toBe('_Type table of `Options` from `/no/such.ts`._');
  });
});

describe('AutoTypeTable', () => {
  it('reads the types of the file, relative to the working directory', async () => {
    const { AutoTypeTable } = await import('./auto-type-table.tsx');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const element = await AutoTypeTable({
        path: 'types.ts',
        name: 'Options',
      });
      expect(Object.keys(element.props.type)).toEqual(
        expect.arrayContaining(['name', 'limit']),
      );
    } finally {
      process.chdir(cwd);
    }
  });
});
