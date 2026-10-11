/** One file a source produces: a page (`.md` / `.mdx`) or an asset such as an image. */
export interface SourceFile {
  /** Path inside the source, forward slashes, no leading slash, no `..`. Pages end in `.md` or `.mdx`. */
  path: string;
  content: string | Uint8Array;
}

/**
 * Where pages come from. The docs folder is one (`createLocalSource`); the others fetch or convert content from
 * elsewhere (a vault, a CMS, HTML files, a remote list) into pages that `dockudos sync` writes into the docs folder.
 *
 * Contract (checked by `assertSourceFiles`, which the tests of every source run): `read` returns the same files
 * for the same input, in path order, with unique, safe paths, and page content that is text.
 */
export interface ContentSource {
  /** A short name, `petstore`-style. */
  readonly name: string;
  read(signal?: AbortSignal): Promise<SourceFile[]>;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

const PAGE = /\.mdx?$/i;
export const isPageFile = (path: string): boolean => PAGE.test(path);

/** Is this a path a source may write: relative, forward slashes, no `.` / `..` segments, nothing hidden or odd? */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 300 || path.startsWith('/') || path.includes('\\'))
    return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F:*?"<>|]/.test(path)) return false;
  return path
    .split('/')
    .every(
      (part) =>
        part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'),
    );
}

/** Throws a `SourceError` naming the first thing in `files` that breaks the contract. */
export function assertSourceFiles(
  files: readonly SourceFile[],
  source = 'source',
): void {
  const seen = new Set<string>();
  let previous = '';
  for (const file of files) {
    if (!isSafePath(file.path))
      throw new SourceError(
        `${source}: "${file.path}" is not a safe relative path.`,
      );
    const key = file.path.toLowerCase();
    if (seen.has(key))
      throw new SourceError(`${source}: "${file.path}" appears twice.`);
    seen.add(key);
    if (file.path < previous)
      throw new SourceError(
        `${source}: files are not in path order at "${file.path}".`,
      );
    previous = file.path;
    if (isPageFile(file.path) && typeof file.content !== 'string')
      throw new SourceError(`${source}: the page "${file.path}" is not text.`);
  }
}

/** Sort files by path, as the contract asks. */
export const sortFiles = (files: SourceFile[]): SourceFile[] =>
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/** Make a page title or name into a path segment: lowercase, dashes, no accents. */
export function slugSegment(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'page';
}

/** `title`, `description`, `date`, `tags` as YAML frontmatter; values that are not valid are left out. */
export function frontmatter(meta: {
  title?: string;
  description?: string;
  date?: string;
  tags?: readonly string[];
}): string {
  const lines: string[] = [];
  const q = (s: string) => JSON.stringify(s.replace(/\s+/g, ' ').trim());
  if (meta.title?.trim()) lines.push(`title: ${q(meta.title)}`);
  if (meta.description?.trim())
    lines.push(`description: ${q(meta.description)}`);
  const date = normalizeDate(meta.date);
  if (date) lines.push(`date: ${date}`);
  const tags = (meta.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length) lines.push(`tags: [${tags.map(q).join(', ')}]`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

/** `YYYY-MM-DD` from a date or a date-time; `undefined` for anything else. */
export function normalizeDate(value: string | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec((value ?? '').trim());
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  // `Date` rolls 30 February over to March; a real date comes back unchanged.
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === iso
    ? iso
    : undefined;
}

/**
 * Make Markdown from outside safe to compile as MDX. MDX reads `{…}` as code and `<…>` as components, so in text
 * (not in code) braces are escaped and a `<` becomes `&lt;`. Fences and inline code are left alone. Raw HTML and
 * `import`/`export` lines do not survive; that is the point.
 */
export function mdxSafe(markdown: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    // Everything between backticks stays; the rest of the line is escaped.
    out.push(
      line
        .split(/(`+[^`]*`+)/)
        .map((part, i) =>
          i % 2 === 1
            ? part
            : part
                .replace(/\\([{}<])/g, '$1') // do not double-escape
                .replace(/[{}]/g, (c) => `\\${c}`)
                .replace(/</g, '&lt;')
                // A link or image that runs code when followed is no link.
                .replace(
                  /\]\(\s*(?:javascript|data|vbscript):(?:[^()]|\([^()]*\))*\)/gi,
                  '](#)',
                )
                // `import` and `export` at the start of a line are JavaScript to MDX, however the rest looks.
                .replace(
                  /^(\s*)(i)(mport\b)|^(\s*)(e)(xport\b)/,
                  (_m, a = '', i, mp, b = '', e, xp) =>
                    i ? `${a}&#105;${mp}` : `${b}&#101;${xp}`,
                ),
        )
        .join(''),
    );
  }
  return out.join('\n');
}

/** A URL safe to put inside Markdown's `(…)`: spaces, brackets and parentheses are percent-encoded. */
export const encodeMdUrl = (url: string): string =>
  url.replace(
    /[()\s<>]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

/** Apply a Markdown wrapper to the words of `text` and leave its leading and trailing spaces outside (`** a **` is not bold). */
export function wrapWords(
  text: string,
  wrap: (words: string) => string,
): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) as RegExpExecArray;
  return m[2] ? `${m[1]}${wrap(m[2] as string)}${m[3]}` : text;
}
