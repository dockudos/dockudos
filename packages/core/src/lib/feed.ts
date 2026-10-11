import { slugify } from './api/text.ts';
import { FenceTracker } from './fence.ts';

export interface UpdateEntry {
  label: string;
  /** `YYYY-MM-DD`, when the entry has a valid one. */
  date?: string;
  tags: string[];
  description?: string;
  /** The MDX between the tags. */
  body: string;
  /** The id of the entry on the page; the page's `#` anchor. */
  anchor: string;
}

/** Blank out fenced code, keeping offsets, so example `<Update>` tags in code are not read as entries. */
function maskFences(source: string): string {
  const tracker = new FenceTracker();
  return source
    .split('\n')
    .map((line) => (tracker.inCode(line) ? ' '.repeat(line.length) : line))
    .join('\n');
}

/** The end of an opening tag that starts at `start`: the index of its `>`, skipping quotes and `{…}`. */
function tagEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

function attribute(attrs: string, name: string): string | undefined {
  const m = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)\\s*\\})`,
  ).exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) : undefined;
}

function tagList(attrs: string): string[] {
  const m = /(?:^|\s)tags\s*=\s*\{\s*\[([^\]]*)\]\s*\}/.exec(attrs);
  if (!m) return [];
  return [...(m[1] as string).matchAll(/"([^"]*)"|'([^']*)'/g)]
    .map((t) => (t[1] ?? t[2]) as string)
    .filter(Boolean);
}

/**
 * The `<Update>` entries of a changelog page, in the order written (newest first, by convention), each with the id
 * the page gives it, so a feed can link to the entry. Entries inside code fences are ignored.
 */
export function extractUpdates(source: string): UpdateEntry[] {
  const text = maskFences(source);
  const entries: UpdateEntry[] = [];
  const seen = new Map<string, number>();
  const open = /<Update\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text))) {
    const end = tagEnd(text, match.index + match[0].length);
    if (end === -1) break;
    const attrs = text.slice(match.index + match[0].length, end);
    if (attrs.trimEnd().endsWith('/')) continue; // <Update ... /> has no body
    const close = text.indexOf('</Update>', end);
    if (close === -1) continue;
    const label = attribute(attrs, 'label');
    if (!label) continue;
    const date = attribute(attrs, 'date');
    const description = attribute(attrs, 'description');
    const base = updateAnchor(label);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    entries.push({
      label,
      ...(date &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(Date.parse(date)) && { date }),
      tags: tagList(attrs),
      ...(description && { description }),
      body: source.slice(end + 1, close).trim(),
      anchor: n ? `${base}-${n + 1}` : base,
    });
    open.lastIndex = close;
  }
  return entries;
}

/** The id an `<Update>` with this label gets on the page. */
export const updateAnchor = (label: string): string => slugify(label);

export interface FeedItem {
  title: string;
  /** Absolute URL. */
  link: string;
  /** Stable identity; default: the link. */
  guid?: string;
  /** `YYYY-MM-DD` or an ISO date-time. */
  date?: string;
  description?: string;
  categories?: string[];
}

export interface FeedChannel {
  title: string;
  /** Absolute URL of the page the feed belongs to. */
  link: string;
  description: string;
  /** Absolute URL of the feed itself. */
  self?: string;
  /** Language tag, like `en` or `pt-BR`. */
  language?: string;
  items: readonly FeedItem[];
  /** Most items kept (the first ones; sort before). */
  limit?: number;
}

const esc = (s: string) =>
  s
    // Characters XML 1.0 does not allow at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** RFC 822 date, as RSS 2.0 wants: `Tue, 31 Mar 2026 00:00:00 GMT`. */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Newest first; items without a date keep their place after the dated ones. */
export function sortNewestFirst<T extends { date?: string }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, order) => ({ item, order, time: toDate(item.date)?.getTime() }))
    .sort(
      (a, b) =>
        (b.time ?? -Infinity) - (a.time ?? -Infinity) || a.order - b.order,
    )
    .map((x) => x.item);
}

/**
 * An RSS 2.0 feed. Everything is escaped; only `http(s)` links are written; the date of the newest item is
 * the channel's `lastBuildDate`, so the same content gives the same file.
 */
export function buildRss(channel: FeedChannel): string {
  const http = (u: string) => /^https?:\/\//i.test(u);
  const items = channel.items
    .filter((i) => i.title && http(i.link))
    .slice(0, channel.limit ?? 50);
  const newest = items.map((i) => toDate(i.date)).find(Boolean);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${esc(channel.title)}</title>`,
    `    <link>${esc(channel.link)}</link>`,
    `    <description>${esc(channel.description || channel.title)}</description>`,
    ...(channel.language
      ? [`    <language>${esc(channel.language)}</language>`]
      : []),
    ...(channel.self && http(channel.self)
      ? [
          `    <atom:link href="${esc(channel.self)}" rel="self" type="application/rss+xml"/>`,
        ]
      : []),
    ...(newest ? [`    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`] : []),
  ];
  for (const item of items) {
    const date = toDate(item.date);
    lines.push(
      '    <item>',
      `      <title>${esc(item.title)}</title>`,
      `      <link>${esc(item.link)}</link>`,
      `      <guid isPermaLink="${item.guid ? 'false' : 'true'}">${esc(item.guid ?? item.link)}</guid>`,
      ...(date ? [`      <pubDate>${rfc822(date)}</pubDate>`] : []),
      ...(item.description
        ? [`      <description>${esc(item.description)}</description>`]
        : []),
      ...(item.categories ?? [])
        .filter(Boolean)
        .map((c) => `      <category>${esc(c)}</category>`),
      '    </item>',
    );
  }
  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}
