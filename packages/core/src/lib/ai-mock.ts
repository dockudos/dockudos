import type {
  EmbeddingProvider,
  GenerateInput,
  LLMProvider,
} from './ai-provider.ts';
import { tokenize } from './keyword-search.ts';

export interface MockLLM extends LLMProvider {
  /** Every request received, oldest first. */
  readonly calls: GenerateInput[];
}

/**
 * A language model for tests and the CI evaluation set: no network, no key, deterministic. `respond`
 * decides the answer for each request; it streams word by word, like a real model.
 */
export function mockLLM(
  respond: (input: GenerateInput) => string | Promise<string> = () =>
    'This is a mock answer.',
): MockLLM {
  const calls: GenerateInput[] = [];
  return {
    id: 'mock',
    calls,
    async *generate(input) {
      calls.push(input);
      const text = await respond(input);
      for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
        if (input.signal?.aborted) return;
        yield piece;
      }
    },
  };
}

/**
 * Embeddings for tests: words are hashed into a fixed number of buckets (the "hashing trick"), so texts
 * that share words get similar vectors. Deterministic, and good enough to exercise vector search.
 */
export function mockEmbeddings(dimensions = 64): EmbeddingProvider {
  return {
    id: 'mock',
    model: `mock-${dimensions}`,
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        for (const term of tokenize(text)) {
          let h = 2166136261;
          for (let i = 0; i < term.length; i++)
            h = Math.imul(h ^ term.charCodeAt(i), 16777619);
          const bucket = (h >>> 0) % dimensions;
          vector[bucket] = (vector[bucket] ?? 0) + ((h >>> 31) & 1 ? -1 : 1);
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((v) => v / norm);
      });
    },
  };
}
