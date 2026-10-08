/**
 * Read a JavaScript literal as it is written in an MDX prop: `{ a: 1, 'b-c': ['x'], d: `text` }`. Objects, arrays,
 * strings (quoted or a template without `${}`), numbers, booleans and `null`; comments and trailing commas are fine.
 * Anything that needs running code (calls, variables, JSX) is not a literal: `undefined` is returned.
 */
export function parseLiteral(source: string): unknown {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError('not a literal');
  };
  const skip = () => {
    for (;;) {
      while (/\s/.test(source[i] ?? '')) i++;
      if (source.startsWith('//', i))
        i =
          source.indexOf('\n', i) < 0 ? source.length : source.indexOf('\n', i);
      else if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) fail();
        i = end + 2;
      } else return;
    }
  };
  const string = (): string => {
    const quote = source[i++] as string;
    let out = '';
    while (i < source.length && source[i] !== quote) {
      const ch = source[i++] as string;
      if (quote === '`' && ch === '$' && source[i] === '{') fail();
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = source[i++] ?? '';
      const map: Record<string, string> = {
        n: '\n',
        t: '\t',
        r: '\r',
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
        $: '$',
      };
      if (esc === 'u') {
        out += String.fromCharCode(parseInt(source.slice(i, i + 4), 16));
        i += 4;
      } else out += map[esc] ?? esc;
    }
    if (source[i++] !== quote) fail();
    return out;
  };
  const value = (): unknown => {
    skip();
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') return string();
    if (ch === '[') {
      i++;
      const list: unknown[] = [];
      for (;;) {
        skip();
        if (source[i] === ']') return (i++, list);
        list.push(value());
        skip();
        if (source[i] === ',') i++;
        else if (source[i] !== ']') fail();
      }
    }
    if (ch === '{') {
      i++;
      const object: Record<string, unknown> = {};
      for (;;) {
        skip();
        if (source[i] === '}') return (i++, object);
        const quoted = source[i] === '"' || source[i] === "'";
        const key = quoted
          ? string()
          : (/^[A-Za-z_$][\w$]*|^-?\d+/.exec(source.slice(i))?.[0] ?? fail());
        if (!quoted) i += key.length;
        skip();
        if (source[i] !== ':') fail();
        i++;
        object[key] = value();
        skip();
        if (source[i] === ',') i++;
        else if (source[i] !== '}') fail();
      }
    }
    const word =
      /^(?:true|false|null|undefined|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w$])/i.exec(
        source.slice(i),
      )?.[0];
    if (word === undefined) return fail();
    i += word.length;
    return word === 'true'
      ? true
      : word === 'false'
        ? false
        : word === 'null'
          ? null
          : word === 'undefined'
            ? undefined
            : Number(word);
  };
  try {
    const result = value();
    skip();
    return i === source.length ? result : undefined;
  } catch {
    return undefined;
  }
}
