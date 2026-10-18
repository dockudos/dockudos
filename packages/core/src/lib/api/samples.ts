import type { HttpRequest } from './request.ts';

/**
 * One language of the code samples. Add your own by passing it to `<ApiOperation languages={[...]} />`
 * (see `defaultSampleLanguages` for the built-in ones).
 */
export interface SampleLanguage {
  /** Stable id, saved as the reader's choice. */
  id: string;
  /** Tab label. */
  label: string;
  /** Language name for syntax highlighting. */
  highlight: string;
  generate(request: HttpRequest): string;
}

/** Identity function that checks the shape of a custom language. */
export const defineSampleLanguage = (
  language: SampleLanguage,
): SampleLanguage => language;

const isJson = (contentType: string) => /\bjson\b/i.test(contentType);

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// -- curl ---------------------------------------------------------------

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export const curl: SampleLanguage = {
  id: 'curl',
  label: 'cURL',
  highlight: 'bash',
  generate({ method, url, headers, body }) {
    const lines = [`curl --request ${method} \\`, `  --url ${shellQuote(url)}`];
    for (const [k, v] of headers) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  --header ${shellQuote(`${k}: ${v}`)}`);
    }
    if (body) {
      lines[lines.length - 1] += ' \\';
      const json = isJson(body.contentType) ? parseJson(body.text) : undefined;
      const text = json?.ok ? JSON.stringify(json.value, null, 2) : body.text;
      lines.push(`  --data ${shellQuote(text)}`);
    }
    return lines.join('\n');
  },
};

// -- JavaScript ---------------------------------------------------------

const indent = (text: string, by: string) =>
  text
    .split('\n')
    .map((l, i) => (i === 0 ? l : by + l))
    .join('\n');

export const javascript: SampleLanguage = {
  id: 'javascript',
  label: 'JavaScript',
  highlight: 'javascript',
  generate({ method, url, headers, body }) {
    const options: string[] = [`  method: ${JSON.stringify(method)},`];
    if (headers.length) {
      options.push(
        '  headers: {',
        ...headers.map(
          ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`,
        ),
        '  },',
      );
    }
    if (body) {
      const json = isJson(body.contentType) ? parseJson(body.text) : undefined;
      options.push(
        json?.ok
          ? `  body: JSON.stringify(${indent(JSON.stringify(json.value, null, 2), '  ')}),`
          : `  body: ${JSON.stringify(body.text)},`,
      );
    }
    return [
      `const response = await fetch(${JSON.stringify(url)}, {`,
      ...options,
      '});',
      '',
      'const data = await response.json();',
      'console.log(data);',
    ].join('\n');
  },
};

// -- Python -------------------------------------------------------------

function pythonLiteral(value: unknown, level = 0): string {
  const pad = '    '.repeat(level + 1);
  const end = '    '.repeat(level);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((v) => pad + pythonLiteral(v, level + 1)).join(',\n')},\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return '{}';
  return `{\n${entries
    .map(
      ([k, v]) => `${pad}${JSON.stringify(k)}: ${pythonLiteral(v, level + 1)}`,
    )
    .join(',\n')},\n${end}}`;
}

export const python: SampleLanguage = {
  id: 'python',
  label: 'Python',
  highlight: 'python',
  generate({ method, url, headers, body }) {
    const args = [
      `    ${JSON.stringify(method)},`,
      `    ${JSON.stringify(url)},`,
    ];
    if (headers.length) {
      args.push(
        '    headers={',
        ...headers.map(
          ([k, v]) => `        ${JSON.stringify(k)}: ${JSON.stringify(v)},`,
        ),
        '    },',
      );
    }
    if (body) {
      const json = isJson(body.contentType) ? parseJson(body.text) : undefined;
      args.push(
        json?.ok
          ? `    json=${indent(pythonLiteral(json.value, 1), '')},`
          : `    data=${JSON.stringify(body.text)},`,
      );
    }
    return [
      'import requests',
      '',
      'response = requests.request(',
      ...args,
      ')',
      '',
      'print(response.json())',
    ].join('\n');
  },
};

// -- Go -----------------------------------------------------------------

/** A Go interpreted string literal (double quotes). JSON escapes are valid Go escapes except `\/`. */
const goString = (s: string) => JSON.stringify(s);

/** A Go raw string when the text has no backtick, which keeps JSON bodies readable. */
const goText = (s: string) => (s.includes('`') ? goString(s) : `\`${s}\``);

export const go: SampleLanguage = {
  id: 'go',
  label: 'Go',
  highlight: 'go',
  generate({ method, url, headers, body }) {
    const json =
      body && isJson(body.contentType) ? parseJson(body.text) : undefined;
    const text = body
      ? json?.ok
        ? JSON.stringify(json.value, null, 2)
        : body.text
      : undefined;
    const imports = [
      '"fmt"',
      '"io"',
      '"net/http"',
      ...(body ? ['"strings"'] : []),
    ].sort();
    return [
      'package main',
      '',
      'import (',
      ...imports.map((i) => `\t${i}`),
      ')',
      '',
      'func main() {',
      ...(text !== undefined
        ? [`\tpayload := strings.NewReader(${goText(text)})`, '']
        : []),
      `\treq, _ := http.NewRequest(${goString(method)}, ${goString(url)}, ${text !== undefined ? 'payload' : 'nil'})`,
      ...headers.map(
        ([k, v]) => `\treq.Header.Add(${goString(k)}, ${goString(v)})`,
      ),
      '',
      '\tres, err := http.DefaultClient.Do(req)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer res.Body.Close()',
      '',
      '\tdata, _ := io.ReadAll(res.Body)',
      '\tfmt.Println(string(data))',
      '}',
    ].join('\n');
  },
};

/** curl, JavaScript (fetch), Python (requests) and Go (net/http). */
export const defaultSampleLanguages: readonly SampleLanguage[] = [
  curl,
  javascript,
  python,
  go,
];
