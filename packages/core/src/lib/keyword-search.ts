import type { ChunkRecord, ContentIndex, PageRecord } from './content-index.ts';

/** One search result: a section of a page, with a snippet around the match. */
export interface SearchHit {
  /** Id of the chunk the hit comes from. */
  id: string;
  /** URL path of the page. */
  path: string;
  /** Title of the page. */
  title: string;
  /** Headings from the outermost to the section's own; empty for the text before the first heading. */
  headingPath: string[];
  /** Id of the section's heading; empty when the hit is the start of the page. */
  anchor: string;
  /** Where to go: the page path, plus `#anchor` when the hit is a section. */
  url: string;
  snippet: Snippet;
  score: number;
}

/** A short piece of text with the character ranges that matched, for highlighting. */
export interface Snippet {
  text: string;
  /** `[start, end)` offsets into `text`. */
  ranges: [number, number][];
}

export interface SearchOptions {
  /** Most hits to return. Default 10. */
  limit?: number;
  /** At most this many hits from one page. Default: no limit. */
  maxPerPage?: number;
  /**
   * Keep only the chunks this returns true for. Retrieval for AI uses it for locale, version and access
   * filters, so text a reader may not see is never ranked.
   */
  filter?: (chunk: ChunkRecord, page: PageRecord) => boolean;
}

/** Anything that can answer a search: the built-in engine, a server endpoint, or a hosted service. */
export interface SearchBackend {
  id: string;
  search(
    query: string,
    options?: SearchOptions,
  ): SearchHit[] | Promise<SearchHit[]>;
}

/** A chunk with its page and score, before it becomes a hit. Used by retrieval. */
export interface ScoredChunk {
  chunk: ChunkRecord;
  page: PageRecord;
  score: number;
  /** Share of the query's content words found in the chunk, 0 to 1. Low coverage means a weak match. */
  coverage?: number;
}

const FIELD_WEIGHT = { text: 1, heading: 3, title: 2, description: 1 };
const K1 = 1.2;
const B = 0.75;
/** Added when the query is exactly a section heading or a page title. */
const EXACT_BONUS = 12;
const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do does for from how i if in into is it its my of on or ' +
    'our so that the their then there these this to us was we what when where which who why will ' +
    'with you your should would could about'
  ).split(' '),
);

const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * Split text into search terms. A word is kept whole and also split at `_` and at camelCase
 * boundaries, so `createAccessProxy` is found by that name and by `access`, and `ERR_PARSE_ARGS` by
 * the whole code or a part. Plain words are lowercased and lightly stemmed (`keys` finds `key`).
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const [word] of text.matchAll(WORD)) wordTerms(word, out);
  return out;
}

function wordTerms(word: string, out: string[]): void {
  const parts = word
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean);
  const whole = word.toLowerCase();
  if (keep(whole)) out.push(stem(whole));
  if (parts.length > 1) {
    for (const part of parts) {
      const t = part.toLowerCase();
      if (keep(t)) out.push(stem(t));
    }
  }
}

const keep = (t: string) => t.length > 1 || /\d/.test(t);

/** A small suffix stripper: enough to match plurals and verb forms, never to change a code or a name. */
export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length < 4) return word;
  let w = word;
  if ((w.endsWith('ies') || w.endsWith('ied')) && w.length > 4)
    w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w) && !w.endsWith('ss')) w = w.slice(0, -1);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

interface Doc {
  chunk: ChunkRecord;
  page: PageRecord;
  length: number;
}

/**
 * Keyword search over a content index: BM25 with section headings and page titles weighing more than
 * body text, prefix matching for the word being typed, and tolerance for one or two typos. Runs in the
 * browser or on the server from the same index.
 */
export class KeywordSearch implements SearchBackend {
  readonly id = 'builtin';
  readonly #docs: Doc[] = [];
  readonly #postings = new Map<string, [number, number][]>();
  #terms: string[] = [];
  #avgLength = 1;

  constructor(index: Pick<ContentIndex, 'pages' | 'chunks'>) {
    const pages = new Map(index.pages.map((p) => [p.path, p]));
    for (const chunk of index.chunks) {
      const page = pages.get(chunk.pagePath);
      if (!page) continue;
      this.#add(chunk, page);
    }
    this.#terms = [...this.#postings.keys()].sort();
    this.#avgLength =
      this.#docs.reduce((n, d) => n + d.length, 0) /
        Math.max(this.#docs.length, 1) || 1;
  }

  #add(chunk: ChunkRecord, page: PageRecord): void {
    const weights = new Map<string, number>();
    const add = (text: string, weight: number): number => {
      const terms = tokenize(text);
      for (const t of terms) weights.set(t, (weights.get(t) ?? 0) + weight);
      return terms.length;
    };
    const length = add(chunk.text, FIELD_WEIGHT.text) || 1;
    const last = chunk.headingPath.length - 1;
    chunk.headingPath.forEach((h, i) =>
      add(h, i === last ? FIELD_WEIGHT.heading : FIELD_WEIGHT.heading / 2),
    );
    add(page.title, FIELD_WEIGHT.title);
    if (page.description) add(page.description, FIELD_WEIGHT.description);

    const id = this.#docs.length;
    this.#docs.push({ chunk, page, length });
    for (const [term, weight] of weights) {
      const list = this.#postings.get(term);
      if (list) list.push([id, weight]);
      else this.#postings.set(term, [[id, weight]]);
    }
  }

  get size(): number {
    return this.#docs.length;
  }

  /** Ranked chunks for a query. Retrieval for the assistant uses this directly. */
  rank(
    query: string,
    { limit = 10, maxPerPage, filter }: SearchOptions = {},
  ): { results: ScoredChunk[]; terms: Set<string> } {
    const terms = new Set<string>();
    const words = queryWords(query);
    if (words.length === 0 || this.#docs.length === 0)
      return { results: [], terms };

    const scores = new Float64Array(this.#docs.length);
    const matched = new Uint8Array(this.#docs.length);
    const n = this.#docs.length;

    words.forEach((word, wi) => {
      const isLast = wi === words.length - 1;
      const wordScore = new Map<number, number>();
      const bump = (term: string, weight: number) => {
        const list = this.#postings.get(term);
        if (!list) return;
        terms.add(term);
        const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
        for (const [doc, wtf] of list) {
          const norm =
            1 - B + (B * (this.#docs[doc]?.length ?? 1)) / this.#avgLength;
          const s = weight * idf * ((wtf * (K1 + 1)) / (wtf + K1 * norm));
          wordScore.set(doc, (wordScore.get(doc) ?? 0) + s);
        }
      };

      const [whole, ...parts] = word.terms;
      if (whole === undefined) return;
      const resolve = (term: string, weight: number) => {
        // The word being typed also stands for every longer word it begins.
        const longer = isLast && term.length >= 2 ? this.#prefixed(term) : [];
        if (this.#postings.has(term)) bump(term, weight);
        // A typo, but not an unfinished word: "compon" is the start of "component", not a misspelling.
        else if (longer.length === 0)
          for (const near of this.#fuzzy(term)) bump(near, weight * 0.5);
        for (const next of longer) bump(next, weight * 0.6);
      };
      resolve(whole, 1);
      for (const part of parts) resolve(part, 0.3);

      for (const [doc, s] of wordScore) {
        scores[doc] = (scores[doc] ?? 0) + s;
        matched[doc] = (matched[doc] ?? 0) + 1;
      }
    });

    const exact = normalize(query);
    const ranked: ScoredChunk[] = [];
    for (let i = 0; i < this.#docs.length; i++) {
      const base = scores[i] ?? 0;
      if (base === 0) continue;
      const doc = this.#docs[i] as Doc;
      if (filter && !filter(doc.chunk, doc.page)) continue;
      const coverage = (matched[i] ?? 0) / words.length;
      let score = base * (0.4 + 0.6 * coverage);
      const heading = doc.chunk.headingPath.at(-1);
      if (
        exact &&
        (heading !== undefined
          ? normalize(heading) === exact
          : normalize(doc.page.title) === exact)
      )
        score += EXACT_BONUS;
      ranked.push({ chunk: doc.chunk, page: doc.page, score, coverage });
    }
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        a.page.path.localeCompare(b.page.path) ||
        a.chunk.id.localeCompare(b.chunk.id),
    );

    const results: ScoredChunk[] = [];
    const perPage = new Map<string, number>();
    for (const r of ranked) {
      if (maxPerPage !== undefined) {
        const count = perPage.get(r.page.path) ?? 0;
        if (count >= maxPerPage) continue;
        perPage.set(r.page.path, count + 1);
      }
      results.push(r);
      if (results.length >= limit) break;
    }
    return { results, terms };
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const { results, terms } = this.rank(query, options);
    return results.map(({ chunk, page, score }) => ({
      id: chunk.id,
      path: page.path,
      title: page.title,
      headingPath: chunk.headingPath,
      anchor: chunk.anchor,
      url: chunk.anchor ? `${page.path}#${chunk.anchor}` : page.path,
      snippet: makeSnippet(chunk.text, terms),
      score,
    }));
  }

  /** Terms that start with `prefix`, most common first. */
  #prefixed(prefix: string): string[] {
    let lo = 0;
    let hi = this.#terms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.#terms[mid] as string) < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < this.#terms.length; i++) {
      const t = this.#terms[i] as string;
      if (!t.startsWith(prefix)) break;
      if (t !== prefix) out.push(t);
    }
    return out
      .sort(
        (a, b) =>
          (this.#postings.get(b)?.length ?? 0) -
          (this.#postings.get(a)?.length ?? 0),
      )
      .slice(0, 20);
  }

  /** Known terms within one or two edits of a word that matches nothing. */
  #fuzzy(term: string): string[] {
    if (term.length < 4) return [];
    const max = term.length >= 8 ? 2 : 1;
    const out: [string, number][] = [];
    for (const t of this.#terms) {
      if (Math.abs(t.length - term.length) > max) continue;
      if (t[0] !== term[0] && t[1] !== term[1]) continue;
      const d = editDistance(term, t, max);
      if (d <= max) out.push([t, d]);
    }
    return out
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([t]) => t);
  }
}

interface QueryWord {
  /** The word whole first, then its parts (for `createAccessProxy`: itself, `create`, `access`, `proxy`). */
  terms: string[];
}

function queryWords(query: string): QueryWord[] {
  const words = [...query.matchAll(WORD)].map(([w]) => {
    const terms: string[] = [];
    wordTerms(w, terms);
    return { raw: w.toLowerCase(), terms };
  });
  const content = words.filter((w) => !STOPWORDS.has(w.raw));
  return (content.length ? content : words).filter((w) => w.terms.length > 0);
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Edit distance (insert, delete, replace, swap two neighbours), giving up with `max + 1` once every
 * path is already beyond `max`.
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const width = b.length + 1;
  let older = new Array<number>(width).fill(0);
  let prev = Array.from({ length: width }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    let best = i;
    for (let j = 1; j < width; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, (older[j - 2] as number) + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    older = prev;
    prev = row;
  }
  return prev[b.length] as number;
}

/** A window of `text` around the first match, with the matched words located for highlighting. */
export function makeSnippet(
  text: string,
  terms: ReadonlySet<string>,
  maxLength = 160,
): Snippet {
  const matches: [number, number][] = [];
  for (const m of text.matchAll(WORD)) {
    const found: string[] = [];
    wordTerms(m[0], found);
    if (found.some((t) => terms.has(t)))
      matches.push([m.index, m.index + m[0].length]);
  }
  if (text.length <= maxLength) return { text, ranges: matches };

  // Start a little before the first match, on a word boundary.
  const first = matches[0]?.[0] ?? 0;
  let start = Math.max(0, first - 40);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < first) start = space + 1;
  }
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + maxLength / 2) end = space;
  }
  const lead = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  const body = text.slice(start, end);
  return {
    text: `${lead}${body}${tail}`,
    ranges: matches
      .filter(([s, e]) => s >= start && e <= end)
      .map(([s, e]): [number, number] => [
        s - start + lead.length,
        e - start + lead.length,
      ]),
  };
}
