import { type HttpFetch, getJson } from './http.ts';
import {
  type ContentSource,
  type SourceFile,
  SourceError,
  encodeMdUrl,
  frontmatter,
  mdxSafe,
  slugSegment,
  sortFiles,
  wrapWords,
} from './types.ts';

export interface NotionOptions {
  name: string;
  /** The Notion page whose sub-pages become the docs. The root page itself is the home page. */
  rootId: string;
  token: string;
  fetch?: HttpFetch;
  /** Most pages read. Default 300. */
  limit?: number;
  /** How deep sub-pages nest. Default 4. */
  depth?: number;
}

interface RichText {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}
interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [type: string]: unknown;
}

const API = 'https://api.notion.com/v1';

function rich(texts: readonly RichText[] | undefined): string {
  return (texts ?? [])
    .map((t) => {
      const raw = t.plain_text ?? '';
      if (!raw.trim()) return raw;
      let s = t.annotations?.code
        ? `\`${raw.trim().replace(/`/g, "'")}\``
        : raw.replace(/([*_`[\]\\])/g, '\\$1');
      if (t.annotations?.bold) s = wrapWords(s, (w) => `**${w}**`);
      if (t.annotations?.italic) s = wrapWords(s, (w) => `*${w}*`);
      if (t.annotations?.strikethrough) s = wrapWords(s, (w) => `~~${w}~~`);
      const href = t.href;
      if (href && /^(https?:|mailto:|\/|#)/i.test(href))
        s = wrapWords(s, (w) => `[${w}](${encodeMdUrl(href)})`);
      return s;
    })
    .join('');
}

const payload = (b: NotionBlock) =>
  (b[b.type] ?? {}) as {
    rich_text?: RichText[];
    caption?: RichText[];
    language?: string;
    checked?: boolean;
    url?: string;
    icon?: { emoji?: string };
    external?: { url?: string };
    file?: { url?: string };
    type?: string;
  };

/** One block (and its children, already converted) as Markdown lines. */
export function blockToMarkdown(
  b: NotionBlock,
  children: string,
  number?: number,
): string | undefined {
  const p = payload(b);
  const text = rich(p.rich_text);
  const indent = (s: string) =>
    s
      .split('\n')
      .map((l) => (l ? `  ${l}` : l))
      .join('\n');
  switch (b.type) {
    case 'paragraph':
      return [text, children].filter(Boolean).join('\n\n') || undefined;
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return `${'#'.repeat(Number(b.type.slice(-1)) + 1)} ${text}`; // page title is h1
    case 'bulleted_list_item':
      return `- ${text}${children ? '\n' + indent(children) : ''}`;
    case 'numbered_list_item':
      return `${number ?? 1}. ${text}${children ? '\n' + indent(children) : ''}`;
    case 'to_do':
      return `- [${p.checked ? 'x' : ' '}] ${text}`;
    case 'quote':
      return [text, children]
        .filter(Boolean)
        .join('\n\n')
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n');
    case 'callout':
      return `:::note\n${[text, children].filter(Boolean).join('\n\n')}\n:::`;
    case 'toggle':
      return [`**${text}**`, children].filter(Boolean).join('\n\n');
    case 'code':
      return (
        '```' +
        (p.language && p.language !== 'plain text' ? p.language : '') +
        '\n' +
        (p.rich_text ?? []).map((t) => t.plain_text).join('') +
        '\n```'
      );
    case 'divider':
      return '---';
    case 'image': {
      const url = p.external?.url ?? p.file?.url;
      return url && /^https:\/\//.test(url)
        ? `![${rich(p.caption).replace(/[\][]/g, '')}](${url})`
        : undefined;
    }
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      return p.url && /^https?:\/\//.test(p.url)
        ? `[${p.url}](${p.url})`
        : undefined;
    default:
      return children || undefined;
  }
}

/** Pages of a Notion workspace, from a root page and its sub-pages. Needs an internal integration token. */
export function createNotionSource(o: NotionOptions): ContentSource {
  return {
    name: o.name,
    async read(signal) {
      if (!/^[0-9a-f-]{32,36}$/i.test(o.rootId))
        throw new SourceError(`${o.name}: rootId must be a Notion page id.`);
      const headers = {
        authorization: `Bearer ${o.token}`,
        'notion-version': '2022-06-28',
        accept: 'application/json',
      };
      const limit = o.limit ?? 300;
      const maxDepth = o.depth ?? 4;
      const files: SourceFile[] = [];

      async function children(id: string): Promise<NotionBlock[]> {
        const all: NotionBlock[] = [];
        let cursor: string | undefined;
        do {
          const url = `${API}/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
          const page = await getJson<{
            results?: NotionBlock[];
            has_more?: boolean;
            next_cursor?: string;
          }>(url, o.name, { fetch: o.fetch, headers, signal });
          all.push(...(page.results ?? []));
          cursor = page.has_more ? page.next_cursor : undefined;
        } while (cursor);
        return all;
      }

      async function render(
        blocks: NotionBlock[],
        depth: number,
      ): Promise<{ markdown: string; subpages: NotionBlock[] }> {
        const parts: string[] = [];
        const subpages: NotionBlock[] = [];
        let number = 0;
        for (const b of blocks) {
          if (b.type === 'child_page') {
            subpages.push(b);
            continue;
          }
          number = b.type === 'numbered_list_item' ? number + 1 : 0;
          let inner = '';
          if (b.has_children && depth < 8 && b.type !== 'child_database')
            inner = (await render(await children(b.id), depth + 1)).markdown;
          const md = blockToMarkdown(b, inner, number);
          if (md !== undefined) parts.push(md);
        }
        // Items of one list stay on adjacent lines.
        const joined = parts.reduce(
          (acc, part, i) =>
            acc +
            (i === 0
              ? ''
              : /^(- |\d+\. )/.test(part) &&
                  /^(- |\d+\. )/.test(parts[i - 1] as string)
                ? '\n'
                : '\n\n') +
            part,
          '',
        );
        return { markdown: joined, subpages };
      }

      async function walk(
        id: string,
        title: string,
        parent: string,
        slug: string,
        depth: number,
      ): Promise<void> {
        if (files.length >= limit)
          throw new SourceError(
            `${o.name}: more than ${limit} pages. Raise the limit or choose a smaller root.`,
          );
        const { markdown, subpages } = await render(await children(id), 0);
        const root = depth === 0;
        const hasChildren = subpages.length > 0 && depth < maxDepth;
        const base = root ? '' : `${parent}${slug}`;
        const path = root
          ? 'index.md'
          : hasChildren
            ? `${base}/index.md`
            : `${base}.md`;
        files.push({
          path,
          content: frontmatter({ title }) + mdxSafe(markdown) + '\n',
        });
        if (!hasChildren) return;
        const used = new Set<string>();
        for (const sub of subpages) {
          const subTitle =
            (sub['child_page'] as { title?: string } | undefined)?.title ??
            'Untitled';
          let name = slugSegment(subTitle);
          for (let i = 2; used.has(name); i++)
            name = `${slugSegment(subTitle)}-${i}`;
          used.add(name);
          await walk(sub.id, subTitle, root ? '' : `${base}/`, name, depth + 1);
        }
      }

      const root = await getJson<{
        properties?: Record<string, { type?: string; title?: RichText[] }>;
      }>(`${API}/pages/${o.rootId}`, o.name, {
        fetch: o.fetch,
        headers,
        signal,
      });
      const titleProp = Object.values(root.properties ?? {}).find(
        (p) => p.type === 'title',
      );
      await walk(
        o.rootId,
        rich(titleProp?.title).replace(/\\/g, '') || 'Home',
        '',
        '',
        0,
      );
      return sortFiles(files);
    },
  };
}
