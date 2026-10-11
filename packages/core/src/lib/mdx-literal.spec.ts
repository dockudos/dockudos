import { parseLiteral } from './mdx-literal.ts';

describe('parseLiteral', () => {
  it('reads objects, arrays, strings, numbers, booleans and null', () => {
    expect(
      parseLiteral(`{ a: 1, 'b-c': [true, null, "x"], "d": \`t\`, e: -2.5, }`),
    ).toEqual({
      a: 1,
      'b-c': [true, null, 'x'],
      d: 't',
      e: -2.5,
    });
  });

  it('skips comments and reads escapes', () => {
    expect(
      parseLiteral(`{ // one\n a: 'it\\'s', /* two */ b: "\\n" }`),
    ).toEqual({ a: "it's", b: '\n' });
  });

  it('gives undefined for anything that needs running code', () => {
    for (const code of [
      'foo',
      'a()',
      '{ a: b }',
      '[1, ...x]',
      '<b>x</b>',
      '`a${b}`',
      '{ a: 1 } extra',
    ]) {
      expect(parseLiteral(code)).toBeUndefined();
    }
  });
});

describe('parseLiteral: input that stops short', () => {
  it('is undefined when a comment, string, list or object is cut off or malformed', () => {
    for (const code of [
      '{ a: 1 /* never closed',
      '"unterminated',
      '[1 2]',
      '[1',
      '{ a 1 }',
      '{ a: 1 b: 2 }',
      '{ a: 1',
      '{ : 1 }',
    ])
      expect(parseLiteral(code), code).toBeUndefined();
  });

  it('reads unicode escapes and keeps an unknown escape as the character', () => {
    expect(parseLiteral('"\\u0041\\q"')).toBe('Aq');
  });

  it('reads numeric keys', () => {
    expect(parseLiteral('{ 1: "a", -2: "b" }')).toEqual({
      '1': 'a',
      '-2': 'b',
    });
  });
});
