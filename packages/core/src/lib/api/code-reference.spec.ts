import { readFileSync } from 'node:fs';
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
