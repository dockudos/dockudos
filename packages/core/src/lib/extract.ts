import GithubSlugger from 'github-slugger';
import { FenceTracker } from './fence.ts';
import { headingText } from './helpers.ts';

/** A heading of a page, with the id the rendered page gives it. */
export interface PageHeading {
  id: string;
  text: string;
  depth: number;
}

/** The text under one heading (up to the next heading of depth 2 to 4). */
export interface PageSection {
  /** Headings from the outermost to this one, without the page title. Empty for the text before the first heading. */
  headingPath: string[];
  /** Id of the section's heading; empty for the text before the first heading. */
  anchor: string;
  depth: number;
  /** Plain text: markup removed, code kept. */
  text: string;
}

export interface ExtractedPage {
  /** First level-one heading, if the source has one. */
  title?: string;
  headings: PageHeading[];
  sections: PageSection[];
}

/** Headings from this depth to this one start a new section; deeper ones stay inside it. */
const MIN_DEPTH = 2;
const MAX_DEPTH = 4;

/** Attributes whose string values are text a reader sees or searches for. */
const TEXT_ATTRIBUTES = new Set([
  'title',
  'description',
  'label',
  'caption',
  'alt',
  'path',
  'method',
  'name',
  'question',
  'header',
]);

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

type Line = { text: string; code: boolean };

/**
 * Read a page's Markdown/MDX (frontmatter removed, `<include>`s expanded) into headings and sections of
 * plain text. Heading ids match the ones the rendered page has (`github-slugger`, like `rehype-slug`), so
 * a section's `anchor` is a working link. Code is kept as text, because people search for API names;
 * imports, comments and JSX tags are dropped, keeping the text between the tags.
 */
export function extractPage(body: string): ExtractedPage {
  const slugger = new GithubSlugger();
  const fence = new FenceTracker();
  const headings: PageHeading[] = [];
  const sections: { meta: Omit<PageSection, 'text'>; lines: Line[] }[] = [];
  let current: (typeof sections)[number] = {
    meta: { headingPath: [], anchor: '', depth: 0 },
    lines: [],
  };
  sections.push(current);
  const path: { depth: number; text: string }[] = [];
  let title: string | undefined;

  for (const raw of body.split(/\r?\n/)) {
    const inFence = fence.inCode(raw);
    const m = inFence ? null : HEADING.exec(raw);
    if (!m) {
      if (inFence && /^\s*(`{3,}|~{3,})/.test(raw)) continue; // the fence lines themselves
      current.lines.push({ text: raw, code: inFence });
      continue;
    }
    const depth = m[1]?.length ?? 0;
    const text = headingText(m[2] ?? '');
    // Every heading takes a slug, so repeated titles number like `rehype-slug`.
    const id = slugger.slug(text);
    if (depth === 1) {
      title ??= text;
      continue;
    }
    if (depth < MIN_DEPTH || depth > MAX_DEPTH) {
      current.lines.push({ text, code: false });
      continue;
    }
    headings.push({ id, text, depth });
    while (path.length && (path.at(-1)?.depth ?? 0) >= depth) path.pop();
    path.push({ depth, text });
    current = {
      meta: { headingPath: path.map((p) => p.text), anchor: id, depth },
      lines: [],
    };
    sections.push(current);
  }

  return {
    ...(title !== undefined && { title }),
    headings,
    sections: sections
      .map(({ meta, lines }) => ({ ...meta, text: linesToText(lines) }))
      .filter((s) => s.text !== '' || s.anchor !== ''),
  };
}

/** The whole page as plain text, for sizing and for tests. */
export function plainTextOf(body: string): string {
  return extractPage(body)
    .sections.map((s) => s.text)
    .filter(Boolean)
    .join('\n\n');
}

function linesToText(lines: Line[]): string {
  const out: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) out.push(proseToText(prose.join('\n')));
    prose = [];
  };
  for (const line of lines) {
    if (line.code) {
      flush();
      out.push(line.text);
    } else prose.push(line.text);
  }
  flush();
  return out
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Private-use characters stand in for inline code while the rest is cleaned, so `Array<string>` survives.
const HOLE_OPEN = '';
const HOLE_CLOSE = '';

const TAG =
  /<\/?(?!https?:|mailto:)[A-Za-z][\w.:-]*(?:\s+(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^>"'{}])*)?\/?>/g;
const ATTRIBUTE = /([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function proseToText(block: string): string {
  const holes: string[] = [];
  const hide = (s: string) => {
    holes.push(s);
    return `${HOLE_OPEN}${holes.length - 1}${HOLE_CLOSE}`;
  };
  let t = block
    // Inline code first: what is inside is text, never markup.
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _q, code: string) =>
      hide(code.trim()),
    )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /^[ \t]*(?:import\s.+|import\s*['"].+|export\s+(?:const|let|var|function|default|async|\{).*)$/gm,
      '',
    );

  t = t.replace(TAG, (tag, offset: number, whole: string) => {
    const values: string[] = [];
    for (const [, name, a, b] of tag.matchAll(ATTRIBUTE)) {
      if (name && TEXT_ATTRIBUTES.has(name)) values.push((a ?? b ?? '').trim());
    }
    // A tag on a line of its own ends the line; a tag inside a sentence is a space.
    const before = whole[offset - 1];
    const after = whole[offset + tag.length];
    const own =
      (before === undefined || before === '\n') &&
      (after === undefined || after === '\n');
    const text = values.join(' ');
    return own ? (text ? `\n${text}\n` : '\n') : text ? ` ${text} ` : ' ';
  });

  t = t
    .replace(
      /^[ \t]*:::+[ \t]*\w*(?:\[(.*?)\])?[ \t]*(.*)$/gm,
      (_, label?: string, rest?: string) => (label || rest || '').trim(),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(
      /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$\n?/gm,
      '',
    )
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) =>
      row
        .split('|')
        .map((c) => c.trim())
        .join(' | '),
    )
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1')
    .replace(/\*\*|~~|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, '')
    .replace(/(?<!\w)(__?)(\S(?:.*?\S)?)\1(?!\w)/g, '$2')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ');

  t = t.replace(
    new RegExp(`${HOLE_OPEN}(\\d+)${HOLE_CLOSE}`, 'g'),
    (_, i: string) => holes[Number(i)] ?? '',
  );
  return t
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}
