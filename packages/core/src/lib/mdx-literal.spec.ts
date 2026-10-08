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
