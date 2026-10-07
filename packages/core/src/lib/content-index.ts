import { type Chunk, type ChunkOptions, chunkSections } from './chunk.ts';
import { extractPage, type PageHeading } from './extract.ts';
import { findAccessRule } from './access.ts';
import type { DocsConfig } from './config.ts';
import { hashText } from './hash.ts';
import type { Page } from './page-tree.ts';

/** Bump when the shape of the index changes; older files are rebuilt, not read. */
export const INDEX_VERSION = 1;

export interface PageRecord {
  /** URL path, e.g. `/guides/auth`. */
  path: string;
  title: string;
  description?: string;
  locale?: string;
  version?: string;
  /** Headings h2 to h4, with the ids the rendered page uses. */
  headings: PageHeading[];
  /** Hash of everything the record was built from; equal hashes mean the page is unchanged. */
  hash: string;
}

export interface ChunkRecord extends Chunk {
  /** Present when embeddings are enabled. */
  vector?: number[];
}

export interface ContentIndex {
  version: number;
  builtAt: string;
  pages: PageRecord[];
  chunks: ChunkRecord[];
  /** Which model the vectors came from; vectors from another model are never mixed in. */
  embeddings?: { provider: string; model?: string; dimensions: number };
}

/** A page ready to be indexed: its record fields and its Markdown body (includes expanded, frontmatter removed). */
export interface IndexInput {
  path: string;
  title: string;
  description?: string;
  locale?: string;
  version?: string;
  body: string;
}

export interface BuildIndexOptions extends ChunkOptions {
  /** A previous index: pages whose content is unchanged are reused as they are, vectors included. */
  previous?: ContentIndex;
  /** Timestamp for `builtAt`. Default: now. */
  now?: Date;
}

export interface BuildIndexResult {
  index: ContentIndex;
  /** Pages taken from `previous` / pages extracted and chunked afresh. */
  reusedPages: number;
  rebuiltPages: number;
}

/** Pages that belong in public outputs: not hidden, not behind an access rule. */
export function isIndexable(
  page: Pick<Page, 'path' | 'hidden'>,
  config: Pick<DocsConfig, 'access'>,
): boolean {
  return !page.hidden && !findAccessRule(config.access.rules, page.path);
}

/** Build the content index: extract, chunk, and reuse whatever did not change since `previous`. */
export function buildContentIndex(
  inputs: readonly IndexInput[],
  options: BuildIndexOptions = {},
): BuildIndexResult {
  const { previous, now = new Date(), maxChars } = options;
  const usable = previous?.version === INDEX_VERSION ? previous : undefined;
  const oldPages = new Map(usable?.pages.map((p) => [p.path, p]));
  const oldChunks = new Map<string, ChunkRecord[]>();
  for (const chunk of usable?.chunks ?? []) {
    const list = oldChunks.get(chunk.pagePath) ?? [];
    list.push(chunk);
    oldChunks.set(chunk.pagePath, list);
  }

  const pages: PageRecord[] = [];
  const chunks: ChunkRecord[] = [];
  let reusedPages = 0;
  for (const input of inputs) {
    // `maxChars` is part of the hash: a new size limit rechunks every page.
    const hash = hashText(
      JSON.stringify([
        input.title,
        input.description,
        input.locale,
        input.version,
        maxChars,
        input.body,
      ]),
    );
    const old = oldPages.get(input.path);
    if (old && old.hash === hash) {
      reusedPages++;
      pages.push(old);
      chunks.push(...(oldChunks.get(input.path) ?? []));
      continue;
    }
    const extracted = extractPage(input.body);
    const record: PageRecord = {
      path: input.path,
      title: input.title,
      ...(input.description && { description: input.description }),
      ...(input.locale && { locale: input.locale }),
      ...(input.version && { version: input.version }),
      headings: extracted.headings,
      hash,
    };
    pages.push(record);
    chunks.push(...chunkSections(input.path, extracted.sections, { maxChars }));
  }

  return {
    index: {
      version: INDEX_VERSION,
      builtAt: now.toISOString(),
      pages,
      chunks,
      ...(usable?.embeddings && { embeddings: usable.embeddings }),
    },
    reusedPages,
    rebuiltPages: inputs.length - reusedPages,
  };
}

/** Is this value a content index this version of dockudos can read? */
export function isContentIndex(value: unknown): value is ContentIndex {
  const v = value as Partial<ContentIndex> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    v.version === INDEX_VERSION &&
    Array.isArray(v.pages) &&
    Array.isArray(v.chunks)
  );
}
