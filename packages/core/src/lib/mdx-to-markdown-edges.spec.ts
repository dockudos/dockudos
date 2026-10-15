import { describe, expect, it } from 'vitest';
import { type ToMarkdown, md } from './markdown-twin.ts';
import { mdxToMarkdown } from './mdx-to-markdown.ts';

const Box = Object.assign(() => null, {
  toMarkdown: ((props, children) =>
    md.block(
      `[${Object.entries(props)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')}]`,
      children,
    )) satisfies ToMarkdown,
});
const convert = (body: string) => mdxToMarkdown(body, { components: { Box } });
const props = async (tag: string) => (await convert(tag)).trim();

describe('reading props', () => {
  it('reads string props in either quote style, booleans and numbers', async () => {
    expect(await props('<Box a="x" b=\'y\' c />')).toBe('[a="x" b="y" c=true]');
    expect(await props('<Box n={3} neg={-2} f={1.5} />')).toBe(
      '[n=3 neg=-2 f=1.5]',
    );
    expect(await props('<Box on={true} off={false} />')).toBe(
      '[on=true off=false]',
    );
  });

  it('reads literal arrays, objects and template strings', async () => {
    expect(await props('<Box list={["a", 2]} />')).toBe('[list=["a",2]]');
    expect(await props('<Box o={{ k: "v" }} />')).toBe('[o={"k":"v"}]');
    expect(await props('<Box t={`plain`} />')).toBe('[t="plain"]');
  });

  it('allows spaces around the equals sign and line breaks between props', async () => {
    expect(await props('<Box a = "x"\n  b = "y"\n/>')).toBe('[a="x" b="y"]');
  });

  it('leaves out a prop that is code rather than a literal, so the component sees only what could be read', async () => {
    expect(await props('<Box a={compute()} b="ok" />')).toBe('[b="ok"]');
    expect(await props('<Box a={cond ? 1 : 2} />')).toBe('[]');
  });

  it('finds the end of an expression through strings, comments and nested braces', async () => {
    expect(await props('<Box a={{ s: "}", t: \'}\' }} />')).toBe(
      '[a={"s":"}","t":"}"}]',
    );
    expect(await props('<Box a={[1, /* } */ 2]} />')).toBe('[a=[1,2]]');
    expect(await props('<Box a={{ x: [1, 2, { y: 3 }] }} />')).toBe(
      '[a={"x":[1,2,{"y":3}]}]',
    );
  });

  it('handles an expression that never closes, and a tag that never ends, without hanging', async () => {
    expect(await convert('<Box a={1')).toBe('<Box a={1');
    expect(await convert('<Box a="x')).toBe('<Box a="x');
    expect(await convert('<Box')).toBe('<Box');
  });

  it('ignores lowercase tags, generics and a bare less-than sign', async () => {
    const text = 'a < b and <div>x</div> and Array<string> and <3';
    expect(await convert(text)).toBe(text);
  });
});

describe('where tags are not tags', () => {
  it('leaves tags inside inline code alone, with any number of backticks', async () => {
    expect(await convert('Use `<Box a="1" />` here')).toBe(
      'Use `<Box a="1" />` here',
    );
    expect(await convert('Use ``<Box /> and ` tick`` here')).toBe(
      'Use ``<Box /> and ` tick`` here',
    );
  });

  it('treats an unclosed backtick as text and still converts what follows', async () => {
    const out = await convert('a ` b <Box x="1" />');
    expect(out).toContain('[x="1"]');
  });

  it('keeps indented and tilde fences exactly, and the quote prefix of fenced code', async () => {
    const body = '~~~js\n<Box />\n~~~\n\n```\n<Box />\n```';
    expect(await convert(body)).toBe(body);
  });

  it('drops MDX comments, imports and exports', async () => {
    const out = await convert(
      "import { A } from './a'\nimport './side-effect'\nexport const meta = {}\nexport default Layout\n\nHello {/* hidden */} there.",
    );
    expect(out).toBe('Hello  there.');
  });
});

describe('closing tags', () => {
  it('drops a closing tag that was never opened', async () => {
    expect(await convert('text </Box> more')).toBe('text  more');
  });

  it('closes the nearest matching open tag, tolerating a mismatched one in between', async () => {
    const out = await convert('<Box a="1">\nx <Box b="2">y</Other> z\n</Box>');
    expect(out).toContain('[a="1"]');
    expect(out).toContain('[b="2"]');
  });

  it('handles an open tag with no close by keeping its content', async () => {
    const out = await convert('<Box a="1">\ncontent that never ends');
    expect(out).toContain('content that never ends');
  });
});

describe('indentation and lists', () => {
  it('takes the nesting indentation off content so it does not become a code block', async () => {
    const out = await convert(
      '<Box>\n    Indented text.\n\n    Another.\n</Box>',
    );
    expect(out).not.toMatch(/^ {4}/m);
    expect(out).toContain('Indented text.');
  });

  it('keeps the indentation of a list continuation line', async () => {
    const out = await convert('<Box>\n- one\n  continued\n- two\n</Box>');
    expect(out).toContain('- one\n  continued\n- two');
  });

  it('joins neighbouring items into one list, even with blank lines between them', async () => {
    const Item = Object.assign(() => null, {
      toMarkdown: ((_p, c) => `${md.item(c.trim())}`) satisfies ToMarkdown,
    });
    const out = await mdxToMarkdown(
      '<Item>a</Item>\n\n<Item>b</Item>\n\n<Item>c</Item>',
      {
        components: { Item },
      },
    );
    expect(out).toBe('- a\n- b\n- c');
  });

  it('collapses runs of blank lines to one', async () => {
    expect(await convert('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('returns an empty string for an empty page', async () => {
    expect(await convert('')).toBe('');
    expect(await convert('   \n\n')).toBe('');
  });
});
