import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

/**
 * MDX <-> editor document. The editor document is ProseMirror JSON (what TipTap holds). Anything the editor cannot
 * show as a visual block (`import`/`export`, `{expressions}`, raw HTML, footnotes, task lists, inline JSX) becomes a
 * `rawBlock`/`rawInline` that carries its exact source text, so a page is never changed by merely opening it.
 */

export interface PM {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PM[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface Node {
  type: string;
  children?: Node[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  align?: (string | null)[] | null;
  name?: string | null;
  attributes?: unknown[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export interface Page {
  /** The text between the `---` lines, exactly as written, or `null` for a page without front matter. */
  frontmatter: string | null;
  doc: PM;
  /** Whatever follows the last block (normally one newline), kept so the end of the file is not rewritten. */
  tail: string;
}

const processor = () =>
  unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMdx);

/** Parse an MDX page. Throws with the parser's message when the MDX is invalid. */
export function parseMdx(source: string): Page {
  const tree = processor().parse(source) as unknown as Node;
  const children = tree.children ?? [];
  let frontmatter: string | null = null;
  const body = children.filter((n, i) => {
    if (i === 0 && n.type === 'yaml') {
      frontmatter = n.value ?? '';
      return false;
    }
    return true;
  });
  const slice = (n: Node) =>
    source.slice(n.position!.start.offset!, n.position!.end.offset!);
  const ctx = { slice };
  const yaml = children[0]?.type === 'yaml' ? children[0] : undefined;
  let prevEnd = yaml ? yaml.position!.end.offset! : 0;
  const content = body.flatMap((n) => {
    const nodes = block(n, ctx).map((pm) => ({
      ...pm,
      // What the block looked like in the file, and the blank space before it: written back unchanged
      // unless the block is edited, so saving a page touches only the lines the author changed.
      attrs: {
        ...pm.attrs,
        orig: slice(n),
        before: source.slice(prevEnd, n.position!.start.offset!),
      },
    }));
    prevEnd = n.position!.end.offset!;
    return nodes;
  });
  return {
    frontmatter,
    tail: source.slice(prevEnd),
    doc: {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    },
  };
}

interface Ctx {
  slice: (n: Node) => string;
}

const raw = (n: Node, ctx: Ctx): PM => ({
  type: 'rawBlock',
  attrs: { source: ctx.slice(n) },
});

function block(n: Node, ctx: Ctx): PM[] {
  const kids = () => (n.children ?? []).flatMap((c) => block(c, ctx));
  switch (n.type) {
    case 'paragraph':
      return [{ type: 'paragraph', ...inline(n.children ?? [], ctx) }];
    case 'heading':
      return [
        {
          type: 'heading',
          attrs: { level: n.depth },
          ...inline(n.children ?? [], ctx),
        },
      ];
    case 'blockquote':
      return [{ type: 'blockquote', content: kids() }];
    case 'code':
      return [
        {
          type: 'codeBlock',
          attrs: { language: n.lang ?? null, meta: n.meta ?? null },
          ...(n.value ? { content: [{ type: 'text', text: n.value }] } : {}),
        },
      ];
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }];
    case 'list': {
      // A task list needs its own node; keep it exact instead of flattening the checkboxes.
      if ((n.children ?? []).some((i) => i.checked != null))
        return [raw(n, ctx)];
      return [
        {
          type: n.ordered ? 'orderedList' : 'bulletList',
          attrs: {
            ...(n.ordered && { start: n.start ?? 1 }),
            spread: !!n.spread,
          },
          content: (n.children ?? []).map((item) => ({
            type: 'listItem',
            attrs: { spread: !!item.spread },
            content: item.children?.length
              ? item.children.flatMap((c) => block(c, ctx))
              : [{ type: 'paragraph' }],
          })),
        },
      ];
    }
    case 'table':
      return [
        {
          type: 'table',
          attrs: { align: n.align ?? [] },
          content: (n.children ?? []).map((row, r) => ({
            type: 'tableRow',
            content: (row.children ?? []).map((cell) => ({
              type: r === 0 ? 'tableHeader' : 'tableCell',
              content: [
                { type: 'paragraph', ...inline(cell.children ?? [], ctx) },
              ],
            })),
          })),
        },
      ];
    case 'mdxJsxFlowElement': {
      const first = n.children?.[0];
      const last = n.children?.at(-1);
      // Without children there is nothing to edit inside: keep the element exactly as written.
      if (!first || !last) return [raw(n, ctx)];
      const text = ctx.slice(n);
      const from = n.position!.start.offset!;
      // The tags are kept verbatim, so attributes (including multi-line `{...}` values) are never re-formatted.
      const open = text
        .slice(0, first.position!.start.offset! - from)
        .trimEnd();
      const close = text.slice(last.position!.end.offset! - from).trimStart();
      return [
        {
          type: 'jsxBlock',
          attrs: { name: n.name ?? '', open, close },
          content: kids(),
        },
      ];
    }
    default:
      // html, mdxjsEsm, mdxFlowExpression, definition, footnoteDefinition, ... : keep the source.
      return [raw(n, ctx)];
  }
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function inline(
  nodes: Node[],
  ctx: Ctx,
  marks: Mark[] = [],
): { content?: PM[] } {
  const out: PM[] = [];
  const push = (n: PM) => out.push(marks.length ? { ...n, marks } : n);
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        if (n.value) push({ type: 'text', text: n.value });
        break;
      case 'strong':
      case 'emphasis':
      case 'delete':
        out.push(
          ...(inline(n.children ?? [], ctx, [
            ...marks,
            {
              type: { strong: 'bold', emphasis: 'italic', delete: 'strike' }[
                n.type
              ]!,
            },
          ]).content ?? []),
        );
        break;
      case 'inlineCode':
        // A mark cannot nest another code mark; the text keeps the surrounding marks plus `code`.
        out.push({
          type: 'text',
          text: n.value ?? '',
          marks: [...marks, { type: 'code' }],
        });
        break;
      case 'link':
        out.push(
          ...(inline(n.children ?? [], ctx, [
            ...marks,
            { type: 'link', attrs: { href: n.url, title: n.title ?? null } },
          ]).content ?? []),
        );
        break;
      case 'image':
        push({
          type: 'image',
          attrs: { src: n.url, alt: n.alt ?? null, title: n.title ?? null },
        });
        break;
      case 'break':
        push({ type: 'hardBreak' });
        break;
      case 'mdxJsxTextElement': {
        const first = n.children?.[0];
        const last = n.children?.at(-1);
        // Inside bold/italic/link the marks would not reach the children: keep the source, as for an empty tag.
        if (!first || !last || marks.length > 0) {
          out.push({ type: 'rawInline', attrs: { source: ctx.slice(n) } });
          break;
        }
        const text = ctx.slice(n);
        const from = n.position!.start.offset!;
        out.push({
          type: 'jsxInline',
          attrs: {
            name: n.name ?? '',
            open: text.slice(0, first.position!.start.offset! - from),
            close: text.slice(last.position!.end.offset! - from),
          },
          ...inline(n.children ?? [], ctx),
        });
        break;
      }
      default:
        // {expressions}, inline html, footnote and link references: keep the source.
        out.push({
          type: 'rawInline',
          attrs: { source: ctx.slice(n) },
        });
    }
  }
  return out.length ? { content: out } : {};
}

// ---------------------------------------------------------------------------------------------------------------

const gap = (
  n: PM,
  first: boolean,
  hasFrontmatter: boolean,
  verbatim: boolean,
): string => {
  const before = n.attrs?.['before'];
  if (first && !hasFrontmatter) return '';
  if (typeof before !== 'string' || !/^\s*$/.test(before)) return '\n\n';
  // Blocks that were on the same line (`<Icon /> <Icon />`) stay there only while they are untouched.
  return before.includes('\n') || verbatim ? before : '\n\n';
};

/** Drop the bookkeeping attributes so two blocks can be compared by what they say. */
const strip = (n: PM): PM => {
  const { orig: _o, before: _b, ...attrs } = n.attrs ?? {};
  return {
    ...n,
    ...(n.attrs && { attrs }),
    ...(n.content && { content: n.content.map(strip) }),
  };
};

/** The block written out from scratch, the way the editor would if the author had made it. */
const fresh = (n: PM): string =>
  stringifier()
    .stringify({ type: 'root', children: toBlock(strip(n)) } as never)
    .replace(/\n+$/, '');

/**
 * The block as it was in the file, when the editor has not changed it. Compared by what each side would
 * write, so attributes the editor adds on its own (column spans, nulls) do not count as an edit.
 */
function unchanged(n: PM): string | undefined {
  const orig = n.attrs?.['orig'];
  if (typeof orig !== 'string') return undefined;
  try {
    const again = parseMdx(orig).doc.content;
    if (again?.length === 1 && fresh(again[0]!) === fresh(n)) return orig;
  } catch {
    /* edited into something that is not MDX on its own: write it out fresh */
  }
  return undefined;
}

const stringifier = () =>
  unified()
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMdx)
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      fence: '`',
      fences: true,
      rule: '-',
      listItemIndent: 'one',
      incrementListMarker: true,
      handlers: {
        // `:::note[Title]` lines are the site's own container syntax: its brackets must stay as typed.
        text(node: Node, parent: unknown, state: any, info: unknown) {
          const value = node.value ?? '';
          return /(^|\n):::/.test(value) ? value : state.safe(value, info);
        },
      },
    });

/** Write a page back to MDX. */
export function serializeMdx(page: Page): string {
  const hasFrontmatter = page.frontmatter !== null;
  let out = hasFrontmatter ? `---\n${page.frontmatter}\n---` : '';
  (page.doc.content ?? []).forEach((n, i) => {
    let piece = unchanged(n);
    const verbatim = piece !== undefined;
    if (piece === undefined) {
      piece = fresh(n);
      if (piece === '') return;
    }
    out += gap(n, i === 0, hasFrontmatter, verbatim) + piece;
  });
  return out + page.tail;
}

const text = (c?: PM[]): string => (c ?? []).map((n) => n.text ?? '').join('');

function toBlock(n: PM): Node[] {
  const kids = () => (n.content ?? []).flatMap(toBlock);
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'paragraph': {
      const children = toInline(n.content ?? []);
      // An empty paragraph is a blank line the author left in the editor, not content.
      return children.length ? [{ type: 'paragraph', children }] : [];
    }
    case 'heading':
      return [
        {
          type: 'heading',
          depth: a['level'] as number,
          children: toInline(n.content ?? []),
        },
      ];
    case 'blockquote':
      return [{ type: 'blockquote', children: kids() }];
    case 'codeBlock':
      return [
        {
          type: 'code',
          lang: (a['language'] as string | null) ?? null,
          meta: (a['meta'] as string | null) ?? null,
          value: text(n.content),
        },
      ];
    case 'horizontalRule':
      return [{ type: 'thematicBreak' }];
    case 'bulletList':
    case 'orderedList':
      return [
        {
          type: 'list',
          ordered: n.type === 'orderedList',
          start:
            n.type === 'orderedList' ? ((a['start'] as number) ?? 1) : null,
          spread: !!a['spread'],
          children: (n.content ?? []).map((item) => ({
            type: 'listItem',
            spread: !!item.attrs?.['spread'],
            children: (item.content ?? []).flatMap(toBlock),
          })),
        },
      ];
    case 'table':
      return [
        {
          type: 'table',
          align: (a['align'] as (string | null)[]) ?? [],
          children: (n.content ?? []).map((row) => ({
            type: 'tableRow',
            children: (row.content ?? []).map((cell) => ({
              type: 'tableCell',
              children: (cell.content ?? []).flatMap((p) =>
                toInline(p.content ?? []),
              ),
            })),
          })),
        },
      ];
    case 'jsxBlock':
      return [
        { type: 'html', value: a['open'] as string },
        ...kids(),
        { type: 'html', value: a['close'] as string },
      ];
    case 'rawBlock':
      return [{ type: 'html', value: a['source'] as string }];
    default:
      return [];
  }
}

function toInline(nodes: PM[]): Node[] {
  // Rebuild nesting from flat marked text: adjacent nodes that share a mark share one wrapper.
  const wrap = (items: PM[], depth: number): Node[] => {
    const out: Node[] = [];
    let i = 0;
    while (i < items.length) {
      const item = items[i]!;
      const mark = item.marks?.[depth];
      if (!mark) {
        out.push(...leaf(item));
        i++;
        continue;
      }
      let j = i + 1;
      while (j < items.length && sameMark(items[j]!.marks?.[depth], mark)) j++;
      const group = items.slice(i, j);
      const children = wrap(group, depth + 1);
      out.push(markNode(mark, children));
      i = j;
    }
    return out;
  };
  return wrap(orderMarks(nodes), 0);
}

const sameMark = (a: Mark | undefined, b: Mark) =>
  !!a &&
  a.type === b.type &&
  JSON.stringify(a.attrs) === JSON.stringify(b.attrs);

/** Outermost first: links, then emphasis, then code, so `**[a](b)**` and `[**a**](b)` both come back as they went in. */
const ORDER = ['link', 'bold', 'italic', 'strike', 'code'];
const orderMarks = (nodes: PM[]): PM[] =>
  nodes.map((n) =>
    n.marks && n.marks.length > 1
      ? {
          ...n,
          marks: [...n.marks].sort(
            (x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type),
          ),
        }
      : n,
  );

function markNode(mark: Mark, children: Node[]): Node {
  switch (mark.type) {
    case 'bold':
      return { type: 'strong', children };
    case 'italic':
      return { type: 'emphasis', children };
    case 'strike':
      return { type: 'delete', children };
    case 'link':
      return {
        type: 'link',
        url: (mark.attrs?.['href'] as string) ?? '',
        title: (mark.attrs?.['title'] as string | null) ?? null,
        children,
      };
    default:
      // `code` is a leaf in mdast: its text is the value.
      return {
        type: 'inlineCode',
        value: children.map((c) => c.value ?? '').join(''),
      };
  }
}

function leaf(n: PM): Node[] {
  switch (n.type) {
    case 'image':
      return [
        {
          type: 'image',
          url: (n.attrs?.['src'] as string) ?? '',
          alt: (n.attrs?.['alt'] as string | null) ?? null,
          title: (n.attrs?.['title'] as string | null) ?? null,
        },
      ];
    case 'hardBreak':
      return [{ type: 'break' }];
    case 'rawInline':
      return [{ type: 'html', value: n.attrs?.['source'] as string }];
    case 'jsxInline':
      return [
        { type: 'html', value: n.attrs?.['open'] as string },
        ...toInline(n.content ?? []),
        { type: 'html', value: n.attrs?.['close'] as string },
      ];
    default:
      return [{ type: 'text', value: n.text ?? '' }];
  }
}
