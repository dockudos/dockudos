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

export interface SanityOptions {
  name: string;
  projectId: string;
  dataset: string;
  /** GROQ returning documents with `title`, `slug` and `body` (Markdown text or Portable Text). */
  query: string;
  token?: string;
  fetch?: HttpFetch;
}

interface Span {
  _type?: string;
  text?: string;
  marks?: string[];
}
interface Block {
  _type?: string;
  _key?: string;
  style?: string;
  listItem?: 'bullet' | 'number';
  level?: number;
  children?: Span[];
  markDefs?: { _key: string; _type: string; href?: string }[];
  asset?: { url?: string };
  alt?: string;
  language?: string;
  code?: string;
}

function spans(block: Block): string {
  const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d]));
  return (block.children ?? [])
    .map((s) => {
      let t = (s.text ?? '').replace(/([*_`[\]\\])/g, '\\$1');
      if (!t.trim()) return t;
      for (const mark of s.marks ?? []) {
        if (mark === 'strong') t = wrapWords(t, (w) => `**${w}**`);
        else if (mark === 'em') t = wrapWords(t, (w) => `*${w}*`);
        else if (mark === 'code')
          t = wrapWords(
            t,
            () => `\`${(s.text ?? '').trim().replace(/`/g, "'")}\``,
          );
        else if (mark === 'strike-through') t = wrapWords(t, (w) => `~~${w}~~`);
        else {
          const def = defs.get(mark);
          const href = def?.href;
          if (
            def?._type === 'link' &&
            href &&
            /^(https?:|\/|#|mailto:)/i.test(href)
          )
            t = wrapWords(t, (w) => `[${w}](${encodeMdUrl(href)})`);
        }
      }
      return t;
    })
    .join('');
}

/** Portable Text (the rich-text format of Sanity) as Markdown. */
export function portableTextToMarkdown(blocks: readonly Block[]): string {
  const out: string[] = [];
  let lists: { kind: string; n: number }[] = [];
  for (const b of blocks) {
    if (b._type === 'block') {
      const text = spans(b).trim();
      if (b.listItem) {
        const depth = Math.max(0, (b.level ?? 1) - 1);
        lists.length = depth + 1;
        // A list of another kind at the same depth starts counting again.
        if (lists[depth]?.kind !== b.listItem)
          lists[depth] = { kind: b.listItem, n: 0 };
        const n = ++(lists[depth] as { n: number }).n;
        out.push(
          `${'  '.repeat(depth)}${b.listItem === 'number' ? `${n}.` : '-'} ${text}`.replace(
            /\n+$/,
            '',
          ),
        );
        continue;
      }
      lists = [];
      if (!text) continue;
      const h = /^h([1-6])$/.exec(b.style ?? '');
      out.push(
        h
          ? `${'#'.repeat(Number(h[1]))} ${text}`
          : b.style === 'blockquote'
            ? `> ${text}`
            : text,
      );
    } else if (b._type === 'code') {
      lists = [];
      out.push('```' + (b.language ?? '') + '\n' + (b.code ?? '') + '\n```');
    } else if (
      b._type === 'image' &&
      b.asset?.url &&
      /^https:\/\//.test(b.asset.url)
    ) {
      lists = [];
      out.push(`![${(b.alt ?? '').replace(/[\][]/g, '')}](${b.asset.url})`);
    }
  }
  // Consecutive list items stay together; everything else is a paragraph.
  return out.reduce((acc, line, i) => {
    const list = /^\s*(-|\d+\.) /.test(line);
    const prevList = i > 0 && /^\s*(-|\d+\.) /.test(out[i - 1] as string);
    return acc + (i === 0 ? '' : list && prevList ? '\n' : '\n\n') + line;
  }, '');
}

/** Documents from a Sanity dataset as pages, one per document with a slug. */
export function createSanitySource(o: SanityOptions): ContentSource {
  return {
    name: o.name,
    async read(signal) {
      if (
        !/^[a-z0-9]+$/.test(o.projectId) ||
        !/^[a-zA-Z0-9_-]+$/.test(o.dataset)
      )
        throw new SourceError(
          `${o.name}: the project id or dataset has characters Sanity does not allow.`,
        );
      const url = `https://${o.projectId}.api.sanity.io/v2021-06-07/data/query/${o.dataset}?query=${encodeURIComponent(o.query)}`;
      const body = await getJson<{ result?: unknown }>(url, o.name, {
        fetch: o.fetch,
        signal,
        headers: {
          accept: 'application/json',
          ...(o.token && { authorization: `Bearer ${o.token}` }),
        },
      });
      if (!Array.isArray(body.result))
        throw new SourceError(
          `${o.name}: the query did not return a list of documents.`,
        );
      const files: SourceFile[] = [];
      const used = new Set<string>();
      for (const doc of body.result as Record<string, unknown>[]) {
        const slug =
          typeof doc['slug'] === 'string'
            ? doc['slug']
            : (doc['slug'] as { current?: string } | undefined)?.current;
        const title =
          typeof doc['title'] === 'string' ? doc['title'] : undefined;
        const raw = doc['body'];
        if (!slug || !title || raw == null) continue;
        const markdown =
          typeof raw === 'string'
            ? mdxSafe(raw)
            : Array.isArray(raw)
              ? mdxSafe(portableTextToMarkdown(raw as Block[]))
              : '';
        let path = slug.split('/').map(slugSegment).join('/');
        for (let i = 2; used.has(path); i++)
          path = `${slug.split('/').map(slugSegment).join('/')}-${i}`;
        used.add(path);
        files.push({
          path: `${path}.md`,
          content:
            frontmatter({
              title,
              description:
                typeof doc['description'] === 'string'
                  ? doc['description']
                  : undefined,
              date:
                typeof doc['date'] === 'string'
                  ? doc['date']
                  : typeof doc['_updatedAt'] === 'string'
                    ? doc['_updatedAt']
                    : undefined,
            }) +
            markdown +
            '\n',
        });
      }
      return sortFiles(files);
    },
  };
}
