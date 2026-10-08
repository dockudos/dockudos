import type { PageHeading } from './extract.ts';

/** What a component knows about where it sits when it writes itself as Markdown. */
export interface MarkdownContext {
  /** Its place among the siblings of the same component (0 for the first `<Step>` of a `<Steps>`). */
  index: number;
  /** The components it is inside, outermost first (`['Tree', 'Tree.Folder']`). */
  parents: readonly string[];
  /** The headings of the page, for a component that lists them. */
  headings: readonly PageHeading[];
  /** Write a fenced block that nothing converts again, and get back the text to return. */
  fence(block: string): string;
}

/**
 * How a component reads as Markdown. `props` are the attributes as written (strings, numbers, booleans, and `{...}`
 * values that are plain literals), `children` is the content already converted. Return the Markdown, or `undefined` to
 * leave the tag as it was written (when a prop it needs could not be read).
 */
export type ToMarkdown<Props = Record<string, unknown>> = (
  props: Props,
  children: string,
  context: MarkdownContext,
) => string | undefined | Promise<string | undefined>;

/**
 * A component that can write itself as Markdown, the way an object can write itself as a string with `toString()`.
 * Attach `toMarkdown` to the component:
 *
 *     export function Badge({ children }: { children: ReactNode }) { ... }
 *     Badge.toMarkdown = ((_props, children) => md.bold(children)) satisfies ToMarkdown;
 *
 * The Markdown twins of pages (`.md`, "copy page", `llms.txt`, the MCP server) call it. A component without one keeps
 * its content, and its title when it has one.
 */
export interface WithToMarkdown<Props = Record<string, unknown>> {
  toMarkdown?: ToMarkdown<Props>;
}

/** Components by the name they have in MDX; a name may be dotted (`Tree.Folder`). */
export type MarkdownComponents = Record<string, unknown>;

/** Put in front of the lines `md.item` writes, so neighbouring ones stay one list; removed from the final text. */
export const LIST_MARK = '\uE004';

/** Content without the blank lines around it; the indentation of its first line stays. */
function trimBlank(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

function section(head: string | undefined, children: string): string {
  return `${head ? `\n\n${head}\n\n` : '\n\n'}${trimBlank(children)}\n\n`;
}

/** Small pieces for writing `toMarkdown`. Block pieces carry their own blank lines; inline ones do not. */
export const md = {
  /** A prop as text, when it is a string or a number. */
  text(value: unknown): string | undefined {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim() || undefined
      : undefined;
  },
  /** A prop that is a list of strings or numbers. */
  list(value: unknown): string[] {
    return Array.isArray(value)
      ? value
          .filter(
            (x): x is string | number =>
              typeof x === 'string' || typeof x === 'number',
          )
          .map(String)
      : [];
  },
  /** Paragraphs on their own: blank line before and after. */
  block: (...parts: (string | undefined | false)[]): string => {
    const text = parts.filter(Boolean).join('\n\n');
    return text ? `\n\n${text}\n\n` : '\n\n';
  },
  /** A heading line, if any, then the content, as paragraphs. */
  section,
  trimBlank,
  bold: (s: string): string => `**${s}**`,
  italic: (s: string): string => `_${s}_`,
  code: (s: string): string =>
    s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``,
  link: (text: string, href?: string): string =>
    href ? `[${text}](${href})` : text,
  /** One line of a list; put several next to each other. */
  item: (s: string, depth = 0): string =>
    `\n${'  '.repeat(depth)}${LIST_MARK}- ${s}`,
  /** A table cell: no pipes or line breaks. */
  cell: (s: unknown): string =>
    String(s ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
  table(head: string[], rows: unknown[][]): string {
    if (!rows.length) return '';
    return [
      `| ${head.join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...rows.map((r) => `| ${r.map(md.cell).join(' | ')} |`),
    ].join('\n');
  },
  /** For a component that only groups what is inside: `Cards.toMarkdown = md.container`. */
  container: ((_props: unknown, children: string) =>
    section(undefined, children)) as ToMarkdown<never>,
  /** A quote headed by what it is (`> **Warning:** text`), with an optional title and a footer. */
  quote(
    label: string,
    title: string | undefined,
    content: string,
    footer?: string,
  ): string {
    const lines = content.trim().split('\n');
    if (title) lines.unshift(md.bold(`${label}: ${title}`), '');
    else if (label)
      lines[0] = `${md.bold(`${label}:`)} ${lines[0] ?? ''}`.trimEnd();
    if (footer) lines.push('', footer);
    return md.block(lines.map((l) => (l ? `> ${l}` : '>')).join('\n'));
  },
};
