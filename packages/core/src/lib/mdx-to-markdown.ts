import { FenceTracker } from './fence.ts';
import { extractPage } from './extract.ts';
import { parseLiteral } from './mdx-literal.ts';
import {
  LIST_MARK,
  type MarkdownComponents,
  type ToMarkdown,
  md,
} from './markdown-twin.ts';

// Private-use characters stand in for fenced code while the rest is converted, so nothing inside code is touched.
const FENCE_OPEN = '';
const FENCE_CLOSE = '';

// -- reading tags -----------------------------------------------------------

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Attribute values: strings as written, `true` for a bare attribute, literals of `{...}` read as values. */
  values: Record<string, unknown>;
  /** Attributes whose `{...}` is code, not a literal. */
  code: string[];
  source: string;
}

interface Found {
  start: number;
  end: number;
  tag: Tag;
}

/** The index after the `}` that closes the `{` at `from`, skipping strings, templates and comments. */
function skipBraces(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
    } else if (ch === '/' && src[i + 1] === '/')
      i = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i);
    else if (ch === '/' && src[i + 1] === '*')
      i =
        src.indexOf('*/', i + 2) < 0
          ? src.length
          : src.indexOf('*/', i + 2) + 1;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

function tagAt(src: string, start: number): Found | undefined {
  let p = start + 1;
  const closing = src[p] === '/';
  if (closing) p++;
  const name = /^[A-Z][\w.]*/.exec(src.slice(p, p + 80))?.[0];
  if (!name) return undefined;
  p += name.length;
  const values: Record<string, unknown> = {};
  const code: string[] = [];
  for (;;) {
    while (/\s/.test(src[p] ?? '')) p++;
    const ch = src[p];
    if (ch === undefined) return undefined;
    const done = (selfClosing: boolean, end: number): Found => ({
      start,
      end,
      tag: {
        name,
        closing,
        selfClosing,
        values,
        code,
        source: src.slice(start, end),
      },
    });
    if (ch === '>') return done(false, p + 1);
    if (ch === '/' && src[p + 1] === '>') return done(true, p + 2);
    if (closing) return undefined;
    if (ch === '{') {
      // {...spread}
      const end = skipBraces(src, p);
      if (end < 0) return undefined;
      p = end;
      continue;
    }
    const key = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(p, p + 80))?.[0];
    if (!key) return undefined;
    p += key.length;
    while (/\s/.test(src[p] ?? '')) p++;
    if (src[p] !== '=') {
      values[key] = true;
      continue;
    }
    p++;
    while (/\s/.test(src[p] ?? '')) p++;
    const quote = src[p];
    if (quote === '"' || quote === "'") {
      const end = src.indexOf(quote, p + 1);
      if (end < 0) return undefined;
      values[key] = src.slice(p + 1, end);
      p = end + 1;
    } else if (quote === '{') {
      const end = skipBraces(src, p);
      if (end < 0) return undefined;
      const inner = src.slice(p + 1, end - 1).trim();
      const parsed = parseLiteral(inner);
      if (parsed !== undefined || inner === 'undefined') values[key] = parsed;
      else code.push(key);
      p = end;
    } else return undefined;
  }
}

function scanTags(src: string): Found[] {
  const found: Found[] = [];
  for (let i = nextMark(src, 0); i >= 0; i = nextMark(src, i)) {
    if (src[i] === '`') {
      // Inline code: what is inside is text, never a tag.
      const run = /^`+/.exec(src.slice(i))?.[0] ?? '`';
      const close = src.indexOf(run, i + run.length);
      i = close < 0 ? i + run.length : close + run.length;
      continue;
    }
    const next = tagAt(src, i);
    if (next) {
      found.push(next);
      i = next.end;
    } else i++;
  }
  return found;
}

const nextMark = (src: string, from: number): number => {
  const tag = src.indexOf('<', from);
  const tick = src.indexOf('`', from);
  return tag < 0 ? tick : tick < 0 ? tag : Math.min(tag, tick);
};

// -- converting -------------------------------------------------------------

type Node =
  | { text: string }
  | { tag: Tag; children: Node[]; closeSource: string };
type Element = Extract<Node, { tag: Tag }>;

/** The tags of a page as a tree. A closing tag with nothing to close is dropped; a tag never closed ends with its parent. */
function parse(body: string): Node[] {
  const root: Node[] = [];
  const open: Element[] = [];
  const add = (node: Node) =>
    (open[open.length - 1]?.children ?? root).push(node);
  let last = 0;
  for (const { start, end, tag } of scanTags(body)) {
    if (start > last) add({ text: body.slice(last, start) });
    last = end;
    if (tag.closing) {
      let at = open.length - 1;
      while (at >= 0 && (open[at] as Element).tag.name !== tag.name) at--;
      if (at >= 0) {
        (open[at] as Element).closeSource = tag.source;
        open.length = at;
      }
      continue;
    }
    const element: Element = { tag, children: [], closeSource: '' };
    add(element);
    if (!tag.selfClosing) open.push(element);
  }
  if (last < body.length) add({ text: body.slice(last) });
  return root;
}

/** The `toMarkdown` of a component by its MDX name; a dotted name (`Tree.Folder`) is looked up as a property path. */
function twinOf(
  components: MarkdownComponents,
  name: string,
): ToMarkdown | undefined {
  let found: unknown = components[name];
  if (!found && name.includes('.')) {
    found = name
      .split('.')
      .reduce<unknown>(
        (o, key) => (o as Record<string, unknown> | undefined)?.[key],
        components,
      );
  }
  const twin = (found as { toMarkdown?: unknown } | undefined)?.toMarkdown;
  return typeof twin === 'function' ? (twin as ToMarkdown) : undefined;
}

interface Shared {
  components: MarkdownComponents;
  fences: string[];
  headings: ReturnType<typeof extractPage>['headings'];
}

async function render(
  nodes: Node[],
  parents: string[],
  shared: Shared,
): Promise<string> {
  const seen = new Map<string, number>();
  let out = '';
  for (const node of nodes) {
    if ('text' in node) {
      out += node.text;
      continue;
    }
    const { tag } = node;
    const index = seen.get(tag.name) ?? 0;
    seen.set(tag.name, index + 1);
    const children = await render(
      node.children,
      [...parents, tag.name],
      shared,
    );
    const twin = twinOf(shared.components, tag.name);
    if (!twin) {
      // A component of the site's own: its content stays, and its title when it has one.
      const title =
        md.text(tag.values.title) ??
        md.text(tag.values.label) ??
        md.text(tag.values.caption);
      out += title ? `${md.block(md.bold(title))}${children}\n\n` : children;
      continue;
    }
    const written = await twin(tag.values, children, {
      index,
      parents,
      headings: shared.headings,
      fence: (block) => {
        shared.fences.push(block);
        return md.block(
          `${FENCE_OPEN}${shared.fences.length - 1}${FENCE_CLOSE}`,
        );
      },
    });
    out += written ?? `${tag.source}${children}${node.closeSource}`;
  }
  return out;
}

/** Replace each fenced code block with a one-line stand-in (which keeps the block's indent); give back the blocks. */
function hideFences(body: string, fences: string[]): string {
  const tracker = new FenceTracker();
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const indent = /^[ \t]*/.exec(run[0] ?? '')?.[0] ?? '';
    fences.push(
      run
        .map((l) =>
          l.startsWith(indent) ? l.slice(indent.length) : l.trimStart(),
        )
        .join('\n'),
    );
    out.push(`${indent}${FENCE_OPEN}${fences.length - 1}${FENCE_CLOSE}`);
    run = [];
  };
  for (const line of body.split(/\r?\n/)) {
    if (tracker.inCode(line)) run.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

const LIST_ITEM = new RegExp(`^[ \\t]*${LIST_MARK}?(?:[-*+]|\\d+[.)])[ \\t]`);

/**
 * Content inside a removed tag is usually indented to show the nesting. In Markdown four spaces make code, so take the
 * indentation off blocks that are not part of a list (a list keeps the indentation of its continuation lines).
 */
function dedent(markdown: string): string {
  const widthOf = (line: string) => /^[ \t]*/.exec(line)?.[0].length ?? 0;
  let inList = false;
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => {
      const lines = paragraph.split('\n');
      const indent = Math.min(...lines.filter((l) => l.trim()).map(widthOf));
      const startsList = LIST_ITEM.test(lines[0] ?? '');
      // Continuation of a list that is already open keeps its indentation; anything else sheds it.
      const keep =
        !Number.isFinite(indent) || indent === 0 || (inList && !startsList);
      if (startsList) inList = true;
      else if (indent === 0) inList = false;
      return keep
        ? paragraph
        : lines.map((l) => l.slice(Math.min(indent, widthOf(l)))).join('\n');
    })
    .join('\n\n');
}

/** Items written by `md.item` that the source's own line breaks separated: they were meant as one list. */
function joinItems(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      let next = i;
      while (next < lines.length && (lines[next] as string).trim() === '')
        next++;
      const before = [...out].reverse().find((l) => l.trim() !== '');
      if (
        before?.includes(LIST_MARK) &&
        (lines[next] ?? '').trimStart().startsWith(LIST_MARK)
      ) {
        i = next - 1;
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface MarkdownOptions {
  /** The components of the site by their MDX name. Each one's `toMarkdown` says how it reads as Markdown. */
  components?: MarkdownComponents;
}

/**
 * MDX as plain Markdown, for the places where a page is read by something other than the rendered site (Markdown twins,
 * "copy page", `llms.txt`, AI tools). Each component writes itself with its own `toMarkdown` (see `WithToMarkdown`);
 * one without keeps its content, and its title when it has one. Code is never touched.
 */
export async function mdxToMarkdown(
  body: string,
  { components = {} }: MarkdownOptions = {},
): Promise<string> {
  const fences: string[] = [];
  const masked = hideFences(body, fences)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(
      /^[ \t]*(?:import\s.+|import\s*['"].+|export\s+(?:const|let|var|function|default|async|\{).*)$/gm,
      '',
    );

  const converted = await render(parse(masked), [], {
    components,
    fences,
    headings: extractPage(body).headings,
  });

  return dedent(joinItems(converted))
    .replaceAll(LIST_MARK, '')
    .replace(
      new RegExp(`^([ \\t>]*)${FENCE_OPEN}(\\d+)${FENCE_CLOSE}[ \\t]*$`, 'gm'),
      (_, prefix: string, n: string) =>
        (fences[Number(n)] ?? '')
          .split('\n')
          .map((l) => `${prefix}${l}`)
          .join('\n'),
    )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
