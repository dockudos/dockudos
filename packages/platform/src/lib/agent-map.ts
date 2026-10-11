import type { ContentIndex } from '@dockudos/core';
import type { ChangedFile } from './git/types.ts';

/** Files whose changes never need documenting: tests, lockfiles, build output, vendored code, docs themselves. */
const IGNORED =
  /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.git|__snapshots__|fixtures?|__tests__|tests?)\/|\.(spec|test)\.[jt]sx?$|_test\.go$|\.lock$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum)$|\.(png|jpe?g|gif|svg|ico|woff2?|map|snap)$|(^|\/)(CHANGELOG|LICENSE)/i;

export const isRelevantCodeFile = (path: string) => !IGNORED.test(path);

const COMMON = new Set([
  'this',
  'that',
  'true',
  'false',
  'null',
  'undefined',
  'return',
  'const',
  'else',
  'from',
  'type',
  'name',
  'data',
  'value',
  'values',
  'error',
  'result',
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'async',
  'await',
  'function',
  'class',
  'interface',
  'export',
  'import',
  'default',
  'public',
  'private',
  'static',
  'void',
  'item',
  'items',
  'list',
  'index',
  'key',
  'keys',
  'path',
  'file',
  'text',
  'size',
  'time',
  'date',
  'user',
  'users',
  'test',
  'main',
  'init',
  'self',
  'args',
  'opts',
  'options',
  'config',
  'props',
  'state',
  'event',
  'input',
  'output',
  'response',
  'request',
  'handler',
  'callback',
  'param',
  'params',
]);

export interface ExtractedSymbols {
  /** Appear on added lines. */
  added: Set<string>;
  /** Appear on removed lines and not on added ones: the docs may describe something that is gone. */
  removed: Set<string>;
  /** Words from file names and folders (`webhooks.ts` -> `webhooks`). */
  terms: Set<string>;
}

const ENV = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const FLAG = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g;
const DECL =
  /\b(?:function\*?|class|interface|type|enum|struct|trait|def|fn|func|record)\s+([A-Za-z_$][\w$]{3,})/g;
const EXPORT_NAMED =
  /\bexport\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z_$][\w$]{3,})/g;
const ROUTE = /['"`](\/(?:api\/)?[a-z0-9][a-z0-9/_:-]{2,})['"`]/g;
const KEY = /^\s*['"]?([a-z][A-Za-z0-9]{3,})['"]?\s*[:=?]/gm;

function symbolsOf(text: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    if (COMMON.has(s.toLowerCase())) return;
    if (s.length < 4 && !s.startsWith('--')) return;
    out.add(s);
  };
  for (const m of text.matchAll(ENV)) add(m[0]);
  for (const m of text.matchAll(FLAG)) add(m[0]);
  for (const m of text.matchAll(DECL)) add(m[1]);
  for (const m of text.matchAll(EXPORT_NAMED)) add(m[1]);
  for (const m of text.matchAll(ROUTE)) add(m[1]);
  // Option and field names are what docs describe most, but common ones would match everything: only keep camelCase or snake_case.
  for (const m of text.matchAll(KEY)) if (/[a-z][A-Z]|_/.test(m[1]!)) add(m[1]);
  return out;
}

export function extractSymbols(
  changed: readonly ChangedFile[],
): ExtractedSymbols {
  const added = new Set<string>();
  const removedAll = new Set<string>();
  const terms = new Set<string>();
  for (const file of changed) {
    if (!isRelevantCodeFile(file.path)) continue;
    const parts = file.path.split('/');
    for (const p of parts.slice(-3)) {
      const word = p
        .replace(/\.[^.]+$/, '')
        .replace(/[-_.]+/g, ' ')
        .trim();
      if (
        word.length >= 3 &&
        !COMMON.has(word.toLowerCase()) &&
        !/^(index|mod|lib|src|util|utils|helpers?)$/i.test(word)
      )
        terms.add(word);
    }
    const plus: string[] = [];
    const minus: string[] = [];
    for (const line of (file.patch ?? '').split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++'))
        plus.push(line.slice(1));
      else if (line.startsWith('-') && !line.startsWith('---'))
        minus.push(line.slice(1));
    }
    for (const s of symbolsOf(plus.join('\n'))) added.add(s);
    for (const s of symbolsOf(minus.join('\n'))) removedAll.add(s);
    if (file.status === 'removed' || file.status === 'renamed')
      for (const s of symbolsOf(minus.join('\n'))) removedAll.add(s);
  }
  const removed = new Set([...removedAll].filter((s) => !added.has(s)));
  return { added, removed, terms };
}

export interface AffectedPage {
  path: string;
  title: string;
  score: number;
  reasons: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface MapOptions {
  /** Most pages to return. Default 5. */
  maxPages?: number;
  /** Lowest score worth a human's time. Default 3 (one exact symbol). */
  minScore?: number;
}

/**
 * Which documentation pages does a code change touch? Evidence, strongest first:
 * a symbol the change adds or removes (environment variable, flag, exported name, route, option) written on the page,
 * especially in code; then the file and folder names found by keyword search. It uses the content index only, so it
 * costs nothing, needs no model, and gives the same answer every time.
 */
export function mapChangesToPages(
  index: Pick<ContentIndex, 'pages' | 'chunks'>,
  changed: readonly ChangedFile[],
  { maxPages = 5, minScore = 3 }: MapOptions = {},
): AffectedPage[] {
  const { added, removed, terms } = extractSymbols(changed);
  const scores = new Map<string, { score: number; reasons: Set<string> }>();
  const bump = (path: string, by: number, reason: string) => {
    const e = scores.get(path) ?? { score: 0, reasons: new Set<string>() };
    e.score += by;
    e.reasons.add(reason);
    scores.set(path, e);
  };

  const patterns = [...added]
    .map((s) => ({
      s,
      kind: 'adds',
      re: new RegExp(`(?<![\\w$-])${escapeRe(s)}(?![\\w$])`),
    }))
    .concat(
      [...removed].map((s) => ({
        s,
        kind: 'removes',
        re: new RegExp(`(?<![\\w$-])${escapeRe(s)}(?![\\w$])`),
      })),
    );
  for (const chunk of index.chunks) {
    for (const { s, kind, re } of patterns) {
      if (!re.test(chunk.text)) continue;
      const inCode = new RegExp(
        '`[^`\\n]*' + escapeRe(s) + '[^`\\n]*`|```[\\s\\S]*?' + escapeRe(s),
      ).test(chunk.text);
      bump(
        chunk.pagePath,
        (inCode ? 4 : 3) * (kind === 'removes' ? 1.5 : 1),
        `${kind} \`${s}\``,
      );
    }
  }
  if (terms.size) {
    // New public surface (a flag, environment variable, route or export) is not documented yet, so no page names it;
    // the file it lives in is the only link. Evidence from names: a page whose address has a segment equal to a folder
    // or file name (`/guides/cli` for `packages/cli/...`) is strong, the word in a title or heading is medium, and in
    // the text it is weak. A page with real name evidence also gets the weight of the new surface.
    const publicSurface = [...added].some(
      (s) =>
        s.startsWith('--') ||
        s.startsWith('/') ||
        /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(s),
    );
    const stem = (w: string) => w.toLowerCase().replace(/(?:ies|es|s)$/, '');
    const wordRe = (t: string) =>
      new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?:s|es)?(?![A-Za-z0-9])`, 'i');
    const nameScore = new Map<string, number>();
    for (const term of terms) {
      const t = term.toLowerCase().replace(/\s+/g, '-');
      for (const page of index.pages) {
        let score = 0;
        if (
          page.path
            .toLowerCase()
            .split('/')
            .some((seg) => stem(seg) === stem(t))
        ) {
          score = 2;
          bump(
            page.path,
            2,
            `file name matches the page address (\`${term}\`)`,
          );
        } else if (
          wordRe(term).test(page.title) ||
          page.headings.some((h) => wordRe(term).test(h.text))
        ) {
          score = 1.5;
          bump(page.path, 1.5, `title mentions "${term}"`);
        }
        nameScore.set(
          page.path,
          Math.max(nameScore.get(page.path) ?? 0, score),
        );
      }
      const seen = new Set<string>();
      for (const chunk of index.chunks)
        if (!seen.has(chunk.pagePath) && wordRe(term).test(chunk.text)) {
          seen.add(chunk.pagePath);
          bump(chunk.pagePath, 0.5, `mentions "${term}"`);
        }
    }
    if (publicSurface)
      for (const [path, n] of nameScore)
        if (n >= 1.5) bump(path, 2, 'adds public surface');
  }
  const title = new Map(index.pages.map((p) => [p.path, p.title]));
  return [...scores]
    .filter(([path, e]) => e.score >= minScore && title.has(path))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, maxPages)
    .map(([path, e]) => ({
      path,
      title: title.get(path)!,
      score: Math.round(e.score * 10) / 10,
      reasons: [...e.reasons].slice(0, 6),
    }));
}
