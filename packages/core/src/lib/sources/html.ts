import {
  type SourceFile,
  encodeMdUrl,
  frontmatter,
  isSafePath,
  mdxSafe,
  sortFiles,
} from './types.ts';

const VOID = new Set([
  'br',
  'hr',
  'img',
  'meta',
  'link',
  'input',
  'source',
  'wbr',
]);
const SKIP = new Set([
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'noscript',
  'svg',
  'head',
  'template',
  'iframe',
  'button',
]);

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1]?.toLowerCase() === 'x'
          ? Number.parseInt(e.slice(2), 16)
          : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** A small, forgiving HTML parser: enough for article pages, not a browser. */
function parse(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re =
    /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1] as Node;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(
        /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
      ))
        attrs[(a[1] as string).toLowerCase()] = decode(
          a[2] ?? a[3] ?? a[4] ?? '',
        );
      // <p> and <li> end the previous one: HTML does not require closing them.
      if (tag === 'p' || tag === 'li') {
        const at = stack.map((n) => n.tag).lastIndexOf(tag);
        if (
          at > 0 &&
          !stack
            .slice(at + 1)
            .some((n) => ['ul', 'ol', 'table'].includes(n.tag))
        )
          stack.length = at;
      }
      const node: Node = { tag, attrs, children: [] };
      (stack[stack.length - 1] as Node).children.push(node);
      if (!VOID.has(tag) && !m[4]) {
        if (tag === 'script' || tag === 'style') {
          const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
          re.lastIndex = end === -1 ? html.length : end;
        } else stack.push(node);
      }
    } else if (m[5] !== undefined) top.children.push(decode(m[5]));
  }
  return root;
}

const text = (n: Node | string): string =>
  typeof n === 'string'
    ? n
    : SKIP.has(n.tag)
      ? ''
      : n.children.map(text).join('');

function inline(nodes: (Node | string)[], base: string): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return n.replace(/\s+/g, ' ');
      if (SKIP.has(n.tag)) return '';
      const inner = () => inline(n.children, base);
      switch (n.tag) {
        case 'strong':
        case 'b': {
          const t = inner().trim();
          return t ? `**${t}**` : '';
        }
        case 'em':
        case 'i': {
          const t = inner().trim();
          return t ? `*${t}*` : '';
        }
        case 'code':
          return `\`${text(n).replace(/`/g, "'")}\``;
        case 'br':
          return '  \n';
        case 'a': {
          const href = safeUrl(n.attrs['href'], base);
          const t = inner().trim();
          return href && t ? `[${t.replace(/[\][]/g, '')}](${href})` : t;
        }
        case 'img': {
          const src = safeUrl(n.attrs['src'], base);
          return src
            ? `![${(n.attrs['alt'] ?? '').replace(/[\][]/g, '')}](${src})`
            : '';
        }
        default:
          return inner();
      }
    })
    .join('');
}

/** Only links and images that cannot run code. */
function safeUrl(url: string | undefined, _base: string): string | undefined {
  const u = (url ?? '').trim();
  if (!u || /^(javascript|data|vbscript):/i.test(u)) return undefined;
  return encodeMdUrl(u);
}

function blocks(nodes: (Node | string)[], base: string, depth = 0): string[] {
  const out: string[] = [];
  let run: (Node | string)[] = [];
  const flush = () => {
    const t = inline(run, base)
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (t) out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (
      typeof n === 'string' ||
      [
        'a',
        'strong',
        'b',
        'em',
        'i',
        'code',
        'span',
        'img',
        'br',
        'small',
        'mark',
        'u',
        'abbr',
        'sup',
        'sub',
        'label',
        'time',
      ].includes(n.tag)
    ) {
      run.push(n);
      continue;
    }
    flush();
    if (SKIP.has(n.tag)) continue;
    const t = n.tag;
    if (/^h[1-6]$/.test(t)) {
      const h = inline(n.children, base).trim();
      if (h) out.push(`${'#'.repeat(Number(t[1]))} ${h}`);
    } else if (t === 'p')
      out.push(
        inline(n.children, base)
          .replace(/[ \t]+/g, ' ')
          .trim(),
      );
    else if (t === 'pre')
      out.push('```\n' + text(n).replace(/\n$/, '') + '\n```');
    else if (t === 'hr') out.push('---');
    else if (t === 'blockquote')
      out.push(
        blocks(n.children, base)
          .join('\n\n')
          .split('\n')
          .map((l) => `> ${l}`.trimEnd())
          .join('\n'),
      );
    else if (t === 'ul' || t === 'ol') {
      const items = n.children.filter(
        (c): c is Node => typeof c !== 'string' && c.tag === 'li',
      );
      out.push(
        items
          .map((li, i) => {
            const inner = blocks(li.children, base, depth + 1).join('\n');
            const mark = t === 'ol' ? `${i + 1}.` : '-';
            return `${mark} ${inner
              .split('\n')
              .map((l, k) => (k ? '  ' + l : l))
              .join('\n')}`;
          })
          .join('\n'),
      );
    } else if (t === 'table') {
      const rows = collectRows(n).map((r) =>
        r.map((c) =>
          inline(c.children, base)
            .replace(/\|/g, '\\|')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [
          ...r,
          ...Array(width - r.length).fill(''),
        ];
        const [head, ...rest] = rows.map(pad) as [string[], ...string[][]];
        out.push(
          [
            `| ${head.join(' | ')} |`,
            `| ${head.map(() => '---').join(' | ')} |`,
            ...rest.map((r) => `| ${r.join(' | ')} |`),
          ].join('\n'),
        );
      }
    } else out.push(...blocks(n.children, base, depth)); // div, section, main, article, figure…
  }
  flush();
  return out;
}

function collectRows(table: Node): Node[][] {
  const rows: Node[][] = [];
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (c.tag === 'tr')
        rows.push(
          c.children.filter(
            (x): x is Node =>
              typeof x !== 'string' && (x.tag === 'td' || x.tag === 'th'),
          ),
        );
      else if (c.tag !== 'table') walk(c);
    }
  };
  walk(table);
  return rows;
}

const find = (n: Node, tag: string): Node | undefined => {
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (c.tag === tag) return c;
    const deeper = find(c, tag);
    if (deeper) return deeper;
  }
  return undefined;
};

/** One HTML page as a Markdown page: the title, the description from `<meta>`, and the main content. */
export function htmlToMarkdown(html: string): {
  title?: string;
  description?: string;
  body: string;
} {
  const root = parse(html);
  const title =
    find(root, 'title') &&
    text(find(root, 'title') as Node)
      .replace(/\s+/g, ' ')
      .trim();
  let description: string | undefined;
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (c.tag === 'meta' && c.attrs['name']?.toLowerCase() === 'description')
        description = c.attrs['content'];
      else walk(c);
    }
  };
  walk(root);
  const main =
    find(root, 'main') ?? find(root, 'article') ?? find(root, 'body') ?? root;
  // `<head>` is skipped by `blocks`; a page that is only a fragment has no body element, so use the root.
  const body = blocks(main.children, '').join('\n\n');
  return {
    title: title || undefined,
    description: description?.trim() || undefined,
    body,
  };
}

/** Convert a folder of HTML files into pages. `index.html` becomes the folder's `index`. */
export function convertHtmlFiles(
  files: readonly { path: string; content: string | Uint8Array }[],
): SourceFile[] {
  const out: SourceFile[] = [];
  for (const f of files) {
    if (
      !isSafePath(f.path) ||
      !/\.html?$/i.test(f.path) ||
      typeof f.content !== 'string'
    )
      continue;
    const { title, description, body } = htmlToMarkdown(f.content);
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
    out.push({
      path: f.path.replace(/\.html?$/i, '.md'),
      content:
        frontmatter({ title: title ?? h1, description }) + mdxSafe(body) + '\n',
    });
  }
  return sortFiles(out);
}
