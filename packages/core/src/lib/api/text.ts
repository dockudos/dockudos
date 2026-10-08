/**
 * Helpers that put text from a spec (or from code) into generated MDX. That text is written by someone else and can
 * contain `{`, `<`, `import` and anything else that would make MDX fail to compile, so it is never pasted in raw.
 */

/** Escape one line of text so MDX shows it literally: no tags, expressions, emphasis, links or tables. */
export function escapeMdx(text: string): string {
  return (
    text
      .replace(/\s+/g, ' ')
      .trim()
      // A Markdown link becomes `text (url)`: the address then stands alone and the URL is not cut by an escape.
      .replace(
        /!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
        (_, label: string, url: string) =>
          label && label !== url ? `${label} (${url}) ` : `${url} `,
      )
      .trim()
      .replace(/[\\`*_{}[\]<>|#&~$]/g, (c) => `\\${c}`)
      .replace(/^([-+]|\d+[.)])(?= )/, '\\$1')
      // `import` and `export` at the start of a paragraph are JavaScript to MDX; an entity keeps them text.
      .replace(/^(i)(mport\b)|^(e)(xport\b)/, (_, a, b, c, d) =>
        a ? `&#105;${b}` : `&#101;${d}`,
      )
  );
}

/** Paragraphs of a description, each escaped onto one line, separated by blank lines. Formatting is dropped. */
export function escapeParagraphs(text: string | undefined): string {
  if (!text) return '';
  return text
    .split(/\n\s*\n/)
    .map(escapeMdx)
    .filter(Boolean)
    .join('\n\n');
}

/** The first paragraph as plain text, shortened, for the page description. */
export function summarize(
  text: string | undefined,
  max = 280,
): string | undefined {
  const first = text
    ?.split(/\n\s*\n/)[0]
    ?.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]|<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!first) return undefined;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** A fenced code block that cannot be closed by what is inside it. */
export function fence(code: string, lang = ''): string {
  const longest = Math.max(
    2,
    ...[...code.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const marks = '`'.repeat(longest + 1);
  return `${marks}${lang}\n${code}\n${marks}`;
}

/** A YAML double-quoted scalar for frontmatter (JSON strings are valid YAML). */
export const yamlString = (s: string): string => JSON.stringify(s);

/** A lowercase, URL-safe path segment. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/**
 * The name of the file a schema is stored in. Injective, and safe on case-insensitive file systems: lowercase letters,
 * digits, `_` and `-` stay, capitals become `~` and the lowercase letter, anything else becomes `.` and its code.
 */
export function schemaFileName(name: string): string {
  let out = '';
  for (const ch of name) {
    if (/[a-z0-9_-]/.test(ch)) out += ch;
    else if (/[A-Z]/.test(ch)) out += `~${ch.toLowerCase()}`;
    else out += `.${ch.codePointAt(0)?.toString(16)}.`;
  }
  return out;
}
