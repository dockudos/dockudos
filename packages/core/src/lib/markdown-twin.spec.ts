import { describe, expect, it } from 'vitest';
import { LIST_MARK, md } from './markdown-twin.ts';

describe('md.text / md.list', () => {
  it('reads strings and numbers as trimmed text, and nothing else', () => {
    expect(md.text(' hi ')).toBe('hi');
    expect(md.text(42)).toBe('42');
    expect(md.text(0)).toBe('0');
    for (const v of ['', '   ', true, null, undefined, {}, [], () => 1])
      expect(md.text(v), String(v)).toBeUndefined();
  });

  it('keeps the strings and numbers of an array as strings, drops the rest', () => {
    expect(md.list(['a', 2, null, true, {}, 'b'])).toEqual(['a', '2', 'b']);
    expect(md.list([])).toEqual([]);
    for (const v of ['a', 5, null, undefined, {}])
      expect(md.list(v)).toEqual([]);
  });
});

describe('md.block / md.section', () => {
  it('puts a blank line before and after, joining parts as paragraphs', () => {
    expect(md.block('a', 'b')).toBe('\n\na\n\nb\n\n');
  });

  it('skips empty parts and is just a break when nothing is left', () => {
    expect(md.block('a', undefined, false, '', 'b')).toBe('\n\na\n\nb\n\n');
    expect(md.block()).toBe('\n\n');
    expect(md.block(undefined, false)).toBe('\n\n');
  });

  it('heads the content when there is a heading, and trims blank lines around the content', () => {
    expect(md.section('**H**', '\n\n  body  \n\n')).toBe(
      '\n\n**H**\n\n  body\n\n',
    );
    expect(md.section(undefined, '\n\nbody\n')).toBe('\n\nbody\n\n');
    expect(md.section('', 'x')).toBe('\n\nx\n\n');
  });

  it("trimBlank drops leading blank lines but keeps the first line's indentation", () => {
    expect(md.trimBlank('\n  \n\t\n    code\n\n')).toBe('    code');
    expect(md.trimBlank('')).toBe('');
  });

  it('container groups what is inside without adding a heading', () => {
    const ctx = {} as never;
    expect(md.container({} as never, '\nx\n', ctx)).toBe('\n\nx\n\n');
  });
});

describe('inline pieces', () => {
  it('bold and italic', () => {
    expect(md.bold('x')).toBe('**x**');
    expect(md.italic('x')).toBe('_x_');
  });

  it('code uses double backticks when the text has a backtick', () => {
    expect(md.code('a')).toBe('`a`');
    expect(md.code('a`b')).toBe('`` a`b ``');
  });

  it('link falls back to the bare text without an address', () => {
    expect(md.link('docs', '/guide')).toBe('[docs](/guide)');
    expect(md.link('docs')).toBe('docs');
    expect(md.link('docs', '')).toBe('docs');
  });

  it('item carries the list mark and indents by depth', () => {
    expect(md.item('a')).toBe(`\n${LIST_MARK}- a`);
    expect(md.item('b', 2)).toBe(`\n    ${LIST_MARK}- b`);
  });
});

describe('md.cell / md.table', () => {
  it('escapes pipes, flattens line breaks and tolerates nothing', () => {
    expect(md.cell('a|b')).toBe('a\\|b');
    expect(md.cell('a \n  b\n')).toBe('a b');
    expect(md.cell(undefined)).toBe('');
    expect(md.cell(null)).toBe('');
    expect(md.cell(3)).toBe('3');
    expect(md.cell(false)).toBe('false');
  });

  it('writes a header, a divider and one row per entry', () => {
    expect(md.table(['A', 'B'], [[1, 'x|y'], ['z']])).toBe(
      '| A | B |\n| --- | --- |\n| 1 | x\\|y |\n| z |',
    );
  });

  it('writes nothing for a table with no rows', () => {
    expect(md.table(['A'], [])).toBe('');
  });
});

describe('md.quote', () => {
  it('labels the first line, and continues the quote on blank lines', () => {
    expect(md.quote('Note', undefined, 'One.\n\nTwo.')).toBe(
      '\n\n> **Note:** One.\n>\n> Two.\n\n',
    );
  });

  it('puts a title on its own line when there is one', () => {
    expect(md.quote('Note', 'Heads up', 'Body')).toBe(
      '\n\n> **Note: Heads up**\n>\n> Body\n\n',
    );
  });

  it('adds a footer after a blank quoted line', () => {
    expect(md.quote('Quote', undefined, 'Words', '— Ada')).toBe(
      '\n\n> **Quote:** Words\n>\n> — Ada\n\n',
    );
  });

  it('has no label prefix when the label is empty', () => {
    expect(md.quote('', undefined, 'Plain')).toBe('\n\n> Plain\n\n');
  });

  it('copes with empty content', () => {
    expect(md.quote('Note', undefined, '')).toBe('\n\n> **Note:**\n\n');
  });
});
