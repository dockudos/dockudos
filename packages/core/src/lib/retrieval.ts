import type { ChunkRecord, ContentIndex, PageRecord } from './content-index.ts';
import type { EmbeddingProvider } from './ai-provider.ts';
import type {
  KeywordSearch,
  ScoredChunk,
  SearchOptions,
} from './keyword-search.ts';

/** Constant of reciprocal rank fusion. 60 is the value from the original paper and works across corpora. */
export const RRF_K = 60;

export interface RetrievedChunk extends ScoredChunk {
  /** Which signals found it. */
  via: ('keyword' | 'vector')[];
  /** Cosine similarity to the query, when vectors were used. */
  similarity?: number;
}

/**
 * Merge several rankings of the same items into one. An item's score is the sum of `1 / (k + rank)` over
 * the rankings that contain it, so being near the top of any list counts and being in several counts more,
 * without having to compare scores that are on different scales. Ties keep the order of the first list.
 */
export function reciprocalRankFusion<T>(
  rankings: readonly (readonly T[])[],
  key: (item: T) => string,
  k = RRF_K,
): { item: T; score: number; found: number[] }[] {
  const merged = new Map<
    string,
    { item: T; score: number; found: number[]; order: number }
  >();
  let order = 0;
  rankings.forEach((ranking, list) => {
    ranking.forEach((item, rank) => {
      const id = key(item);
      const entry = merged.get(id) ?? {
        item,
        score: 0,
        found: [],
        order: order++,
      };
      entry.score += 1 / (k + rank + 1);
      entry.found.push(list);
      merged.set(id, entry);
    });
  });
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item, score, found }) => ({ item, score, found }));
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RetrieveOptions extends Pick<SearchOptions, 'filter'> {
  /** How many chunks to return. Default 8. */
  limit?: number;
  /** Where meaning-based search comes from. Without it (or without vectors in the index), keywords alone. */
  embeddings?: EmbeddingProvider;
  /** Vectors below this similarity to the query are not considered. Default 0.25. */
  minSimilarity?: number;
  signal?: AbortSignal;
}

export interface Retrieval {
  chunks: RetrievedChunk[];
  /** `hybrid` when keyword and vector rankings were merged, else `keyword`. */
  mode: 'keyword' | 'hybrid';
  /** Why vectors were not used, when embeddings were expected: the query embedding failed. */
  vectorError?: string;
}

/** Does the index carry vectors made by this provider's model? Vectors from another model are ignored. */
export function hasVectorsFor(
  index: Pick<ContentIndex, 'embeddings' | 'chunks'>,
  embeddings: EmbeddingProvider | undefined,
): boolean {
  const meta = index.embeddings;
  if (!embeddings || !meta) return false;
  if (meta.provider !== embeddings.id) return false;
  if (embeddings.model && meta.model && meta.model !== embeddings.model)
    return false;
  return index.chunks.some((c) => c.vector);
}

/**
 * Find the chunks most relevant to a query: keyword search (BM25) and, when the index has vectors, vector
 * similarity, merged by reciprocal rank fusion. The `filter` is applied to both before ranking, so a chunk
 * the reader may not see is never a candidate. If embedding the query fails, keywords alone answer.
 */
export async function retrieve(
  query: string,
  index: ContentIndex,
  keyword: KeywordSearch,
  {
    limit = 8,
    embeddings,
    filter,
    minSimilarity = 0.25,
    signal,
  }: RetrieveOptions = {},
): Promise<Retrieval> {
  const pool = limit * 4;
  const byKeyword: RetrievedChunk[] = keyword
    .rank(query, { limit: pool, filter })
    .results.map((r) => ({ ...r, via: ['keyword' as const] }));

  if (!hasVectorsFor(index, embeddings) || !embeddings)
    return { chunks: byKeyword.slice(0, limit), mode: 'keyword' };

  let queryVector: number[] | undefined;
  try {
    queryVector = (await embeddings.embed([query], { signal }))[0];
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      chunks: byKeyword.slice(0, limit),
      mode: 'keyword',
      vectorError: (error as Error).message,
    };
  }
  if (!queryVector)
    return { chunks: byKeyword.slice(0, limit), mode: 'keyword' };

  const pages = new Map<string, PageRecord>(
    index.pages.map((p) => [p.path, p]),
  );
  const byVector: RetrievedChunk[] = [];
  for (const chunk of index.chunks as ChunkRecord[]) {
    if (!chunk.vector) continue;
    const page = pages.get(chunk.pagePath);
    if (!page || (filter && !filter(chunk, page))) continue;
    const similarity = cosine(queryVector, chunk.vector);
    if (similarity >= minSimilarity)
      byVector.push({
        chunk,
        page,
        score: similarity,
        similarity,
        via: ['vector'],
      });
  }
  byVector.sort(
    (a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
  );
  byVector.length = Math.min(byVector.length, pool);

  const fused = reciprocalRankFusion([byKeyword, byVector], (r) => r.chunk.id);
  return {
    mode: 'hybrid',
    chunks: fused.slice(0, limit).map(({ item, score, found }) => {
      const vector = byVector.find((v) => v.chunk.id === item.chunk.id);
      const keywordHit = byKeyword.find((k) => k.chunk.id === item.chunk.id);
      return {
        chunk: item.chunk,
        page: item.page,
        score,
        coverage: keywordHit?.coverage,
        ...(vector && { similarity: vector.similarity }),
        via: found.map((i) =>
          i === 0 ? ('keyword' as const) : ('vector' as const),
        ),
      };
    }),
  };
}
