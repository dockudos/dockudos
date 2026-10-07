import type { EmbeddingProvider } from './ai-provider.ts';
import {
  type ChunkRecord,
  type ContentIndex,
  type PageRecord,
} from './content-index.ts';
import { hashText } from './hash.ts';

/**
 * What is embedded for a chunk: its page title and heading path in front of its text, so a section called
 * "Rotate keys" still means something about keys when its text only says "Do this every ninety days".
 */
export function embeddingText(
  page: Pick<PageRecord, 'title'>,
  chunk: Pick<ChunkRecord, 'headingPath' | 'text'>,
): string {
  return [[page.title, ...chunk.headingPath].join(' > '), chunk.text].join(
    '\n\n',
  );
}

/** Cache key of a vector: the model and the exact text embedded. Same text, same model, same vector. */
const vectorKey = (model: string, text: string) =>
  hashText(`${model}\u0000${text}`);

export interface EmbedResult {
  index: ContentIndex;
  /** Chunks sent to the provider / chunks whose vector came from the previous index. */
  embedded: number;
  reused: number;
}

/**
 * Give every chunk of the index a vector. Vectors already in `previous` (matched by model and text, not by
 * position) are reused, so only new or changed chunks are sent to the provider. Vectors from a different
 * model are dropped, since vectors of different models cannot be compared.
 */
export async function embedIndex(
  index: ContentIndex,
  provider: EmbeddingProvider,
  {
    previous,
    signal,
    batchSize = 96,
  }: {
    previous?: ContentIndex;
    signal?: AbortSignal;
    batchSize?: number;
  } = {},
): Promise<EmbedResult> {
  const model = provider.model ?? provider.id;
  const compatible = (i: ContentIndex | undefined) =>
    i?.embeddings?.provider === provider.id &&
    (i.embeddings.model ?? model) === model;

  const cache = new Map<string, number[]>();
  for (const source of [previous, index]) {
    if (!source || !compatible(source)) continue;
    const pages = new Map(source.pages.map((p) => [p.path, p]));
    for (const chunk of source.chunks) {
      const page = pages.get(chunk.pagePath);
      if (chunk.vector && page)
        cache.set(vectorKey(model, embeddingText(page, chunk)), chunk.vector);
    }
  }

  const pages = new Map(index.pages.map((p) => [p.path, p]));
  const keys: string[] = [];
  const todo: { at: number; text: string }[] = [];
  const chunks: ChunkRecord[] = index.chunks.map(
    ({ vector: _drop, ...chunk }, at) => {
      const page = pages.get(chunk.pagePath);
      const text = page ? embeddingText(page, chunk) : chunk.text;
      const key = vectorKey(model, text);
      keys.push(key);
      const hit = cache.get(key);
      if (hit) return { ...chunk, vector: hit };
      todo.push({ at, text });
      return chunk;
    },
  );

  // Identical texts are embedded once.
  const unique = [
    ...new Map(todo.map((t) => [keys[t.at] as string, t.text])).entries(),
  ];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const vectors = await provider.embed(
      batch.map(([, text]) => text),
      { signal },
    );
    if (vectors.length !== batch.length)
      throw new Error(
        'The embeddings provider returned the wrong number of vectors.',
      );
    batch.forEach(([key], n) => cache.set(key, vectors[n] as number[]));
  }
  for (const { at } of todo) {
    const chunk = chunks[at] as ChunkRecord;
    chunks[at] = {
      ...chunk,
      vector: cache.get(keys[at] as string) as number[],
    };
  }

  const dimensions =
    chunks.find((c) => c.vector)?.vector?.length ?? provider.dimensions;
  return {
    index: {
      ...index,
      chunks,
      embeddings: { provider: provider.id, model, dimensions },
    },
    embedded: unique.length,
    reused: index.chunks.length - todo.length,
  };
}
