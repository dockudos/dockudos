import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePython, generateTypeScript, griffeExpr } from './reference.ts';
import { ApiSpecError } from './types.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const page = (files: { file: string; content: string }[], end: string) =>
  files.find((f) => f.file.endsWith(end))?.content ?? '';

describe('TypeScript reference', () => {
  it('writes a page for every export, found through re-exports', async () => {
    const { files, pages } = await generateTypeScript(
      [join(fixtures, 'sdk-index.ts')],
      fixtures,
      { name: 'sdk', base: 'docs/sdk' },
    );
    expect(pages).toBe(6);
    expect(files.map((f) => f.file).sort()).toEqual([
      'docs/sdk/classes/client.mdx',
      'docs/sdk/enums/color.mdx',
      'docs/sdk/functions/connect.mdx',
      'docs/sdk/index.mdx',
      'docs/sdk/interfaces/connectoptions.mdx',
      'docs/sdk/types/level.mdx',
      'docs/sdk/variables/default-timeout.mdx',
    ]);
  });

  it('reads signatures, parameters with their tags, returns, members, defaults and deprecation', async () => {
    const { files } = await generateTypeScript(
      [join(fixtures, 'sdk.ts')],
      fixtures,
      { name: 'sdk', base: 'docs/sdk' },
    );
    const fn = page(files, 'functions/connect.mdx');
    expect(fn).toContain(
      'function connect(options: ConnectOptions, retries?: number): Client',
    );
    expect(fn).toContain('| options | ConnectOptions | How to connect. |');
    expect(fn).toContain('| retries | number | How many times to retry. |');
    expect(fn).toContain('## Returns\n\n`Client`');
    expect(fn).toContain('const c = connect(');
    const iface = page(files, 'interfaces/connectoptions.mdx');
    expect(iface).toContain('| url | string | Base URL of the API. |');
    expect(iface).toContain(
      '| timeout? | number | Seconds to wait. · optional |',
    );
    expect(iface).toContain('deprecated');
    expect(page(files, 'classes/client.mdx')).toContain(
      '| hello | (name: string) =\\> string | Say hello. |',
    );
    expect(page(files, 'enums/color.mdx')).toContain('| Red | Red. |');
    expect(page(files, 'types/level.mdx')).toContain("'debug' | 'info'");
    expect(page(files, 'variables/default-timeout.mdx')).toContain(
      '`DEFAULT_TIMEOUT: number`',
    );
  });

  it('names a file that is not there', async () => {
    await expect(
      generateTypeScript([join(fixtures, 'none.ts')], fixtures, {
        name: 's',
        base: 'd',
      }),
    ).rejects.toThrow(ApiSpecError);
  });
});

describe('Python reference (Griffe)', () => {
  const dump = readFileSync(join(fixtures, 'shop-griffe.json'), 'utf8');

  it('writes a module page with signatures and docstrings, leaving out private names and imports', () => {
    const { files, pages } = generatePython(dump, 'griffe.json', {
      name: 'py',
      base: 'docs/py',
    });
    expect(pages).toBe(1);
    const mod = page(files, 'modules/shop.mdx');
    expect(mod).toContain(
      'connect(url: str, *args: str, **kwargs: int) -> Client',
    );
    expect(mod).toContain(
      'get_product(self, product_id: int, expand: Optional[list[str]] = None) -> dict',
    );
    expect(mod).toContain('## class Client');
    expect(mod).toContain('`base_url: str`');
    expect(mod).toContain('Open a client.');
    expect(mod).not.toContain('_private');
    expect(mod).not.toContain('## Optional');
    expect(page(files, 'py/index.mdx')).toContain(
      '| shop | A tiny shop SDK. |',
    );
  });

  it('explains input that is not a Griffe dump', () => {
    expect(() =>
      generatePython('not json', 'g.json', { name: 'p', base: 'd' }),
    ).toThrow(/g\.json: is not JSON/);
    expect(() =>
      generatePython('{"a":1}', 'g.json', { name: 'p', base: 'd' }),
    ).toThrow(/not the output of `griffe dump`/);
  });

  it('reads annotation trees', () => {
    expect(
      griffeExpr({
        cls: 'ExprSubscript',
        left: { cls: 'ExprName', name: 'dict' },
        slice: {
          cls: 'ExprTuple',
          elements: [
            { cls: 'ExprName', name: 'str' },
            { cls: 'ExprName', name: 'int' },
          ],
        },
      }),
    ).toBe('dict[str, int]');
    expect(griffeExpr(['a', { cls: 'ExprName', name: 'b' }])).toBe('ab');
    expect(griffeExpr(null)).toBe('');
  });
});

describe('griffeExpr: every shape of expression', () => {
  const name = (n: string) => ({ cls: 'ExprName', name: n });
  it('writes numbers, booleans, attributes, operators, lists and unknown nodes', () => {
    expect(griffeExpr(3)).toBe('3');
    expect(griffeExpr(true)).toBe('true');
    expect(griffeExpr({ not: 'an expression' })).toBe('');
    expect(griffeExpr(Symbol.for('x'))).toBe('');
    expect(
      griffeExpr({
        cls: 'ExprAttribute',
        values: [name('os'), '..', name('path')],
      }),
    ).toBe('os..path'.replace('..', '.'));
    expect(
      griffeExpr({
        cls: 'ExprBinOp',
        left: name('int'),
        operator: '|',
        right: name('None'),
      }),
    ).toBe('int | None');
    expect(
      griffeExpr({ cls: 'ExprBinOp', left: name('a'), right: name('b') }),
    ).toBe('a | b');
    expect(
      griffeExpr({ cls: 'ExprList', elements: [name('a'), name('b')] }),
    ).toBe('a, b');
    expect(griffeExpr({ cls: 'ExprSet' })).toBe('');
    expect(griffeExpr({ cls: 'ExprOther', name: 'n' })).toBe('n');
    expect(griffeExpr({ cls: 'ExprOther', value: 'v' })).toBe('v');
    expect(griffeExpr({ cls: 'ExprOther' })).toBe('');
  });
});

describe('Python reference: a dump written by hand', () => {
  const doc = (value: string) => ({ value });
  const dump = JSON.stringify({
    pkg: {
      kind: 'module',
      name: 'pkg',
      docstring: doc('The package.'),
      members: {
        fn: {
          kind: 'function',
          name: 'fn',
          docstring: doc('Do it.'),
          parameters: [
            { name: 'a', annotation: 'int', default: '1' },
            { name: 'args', kind: 'variadic positional' },
            { name: 'kwargs', kind: 'variadic keyword', default: '{}' },
            { name: 'b', default: null },
          ],
          returns: 'str',
        },
        bare: { kind: 'function', name: 'bare' },
        Base: { kind: 'class', name: 'Base' },
        Child: {
          kind: 'class',
          name: 'Child',
          bases: ['Base', { cls: 'ExprName', name: 'Mixin' }, null],
          docstring: doc('A child.'),
        },
        sub: {
          kind: 'module',
          name: 'sub',
          members: {
            deep: { kind: 'function', name: 'deep' },
            nested: { kind: 'module', name: 'nested', members: {} },
          },
        },
        empty: { kind: 'module', name: 'empty', members: {} },
        value: { kind: 'attribute', name: 'value' },
      },
    },
  });

  it('writes functions, classes with and without bases, and nested modules', () => {
    const { files } = generatePython(dump, 'g.json', {
      name: 'py',
      base: 'docs/py',
    });
    const root = page(files, 'modules/pkg.mdx');
    expect(root).toContain('The package.');
    expect(root).toContain('fn(a: int = 1, *args, **kwargs, b) -> str');
    expect(root).toContain('bare()');
    expect(root).toContain('Bases: `Base`, `Mixin`');
    expect(root).toContain('A child.');
    expect(page(files, 'modules/pkg/sub.mdx')).toContain('deep()');
    // A module with nothing to show gets no page.
    expect(files.some((f) => f.file.endsWith('nested.mdx'))).toBe(false);
    expect(files.some((f) => f.file.endsWith('empty.mdx'))).toBe(false);
  });
});

describe('TypeScript reference: awkward exports', { timeout: 30_000 }, () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dockudos-ts-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (file: string, text: string) =>
    writeFileSync(join(dir, file), text);

  it('numbers exports whose pages would share a name, and handles namespaces and generics', async () => {
    write(
      'index.ts',
      [
        'export const Thing = 1;',
        'export const thing = 2;',
        'export const index = 3;',
        'export namespace Ns { export const inner = 1; }',
        'export declare function over(a: string): string;',
        'export declare function over(a: number): number;',
        'export class Box<T extends object = {}> { value!: T; get size(): number { return 1; } static make(): void {} }',
        'export interface Empty {}',
        'export type Union = "a" | "b";',
        'export type Obj = { a: string };',
        'export default class {}',
        'export * as helpers from "./helpers.ts";',
      ].join('\n'),
    );
    write('helpers.ts', 'export const help = 1;\n');
    const { files } = await generateTypeScript([join(dir, 'index.ts')], dir, {
      name: 't',
      base: 'docs/t',
    });
    const names = files.map((f) => f.file);
    expect(names).toEqual(
      expect.arrayContaining([
        'docs/t/variables/thing.mdx',
        'docs/t/variables/thing-2.mdx',
        'docs/t/variables/index-2.mdx',
      ]),
    );
    expect(page(files, 'classes/box.mdx')).toContain('value');
  });

  it('names an entry that is not a TypeScript file, and skips one with no exports', async () => {
    write('plain.ts', 'const x = 1;\n');
    write('index.ts', 'export const a = 1;\n');
    const { pages } = await generateTypeScript(
      [join(dir, 'plain.ts'), join(dir, 'index.ts')],
      dir,
      { name: 't', base: 'docs/t' },
    );
    expect(pages).toBe(1);
  });
});
