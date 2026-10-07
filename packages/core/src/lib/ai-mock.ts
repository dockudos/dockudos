import type {
  EmbeddingProvider,
  GenerateInput,
  LLMProvider,
} from './ai-provider.ts';
import { NO_ANSWER, parseExcerpts } from './ask.ts';
import { tokenize } from './keyword-search.ts';
import { parseOptions } from './navigate.ts';

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

const FILLER = new Set(
  'the and for are but not you your how what when why where which who can could should would does did its our any all out has have had was were been being into from with about that this these those there their them then than too very just also may might will shall need get got one two use used using make many much'.split(
    ' ',
  ),
);
const contentWords = (text: string) =>
  [...new Set(tokenize(text))].filter((t) => t.length > 2 && !FILLER.has(t));

/**
 * A stand-in for a language model that needs no network and always does the sensible, boring thing: it answers a
 * question with the sentence of the excerpts that shares the most words with it and cites that excerpt, says
 * `NO_ANSWER` when no sentence shares enough, and picks navigation options the same way. It is what the CI
 * evaluation runs against, so the pipeline around the model (retrieval, prompts, citation checks, refusals) is
 * what gets measured. It says nothing about how a real model will do.
 */
export function extractiveLLM(): MockLLM {
  return mockLLM((input) => {
    const last = input.messages.at(-1)?.content ?? '';

    const options = parseOptions(last);
    if (options.length) {
      const wanted = new Set(contentWords(options[0]?.request ?? ''));
      const scored = options
        .map((o) => {
          const have = new Set(contentWords(`${o.where} ${o.where} ${o.text}`));
          return {
            n: o.n,
            where: o.where,
            score: [...wanted].filter((w) => have.has(w)).length,
          };
        })
        .sort((a, b) => b.score - a.score || a.n - b.n);
      const [best, next] = scored;
      if (!best || best.score === 0)
        return JSON.stringify({
          choice: 0,
          confidence: 'low',
          reason: 'Nothing fits.',
        });
      return JSON.stringify({
        choice: best.n,
        confidence: next && next.score === best.score ? 'low' : 'high',
        reason: `This section covers ${best.where.split(' › ').at(-1)?.toLowerCase()}.`,
      });
    }

    const excerpts = parseExcerpts(last);
    const question = /Question: ([\s\S]*)$/.exec(last)?.[1] ?? '';
    const asked = contentWords(question);
    // A sentence is read in the light of the heading it sits under, as a person would.
    const candidates = excerpts.flatMap(({ n, text, where }) =>
      (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) ?? [text]).map(
        (sentence) => ({
          n,
          sentence: sentence.trim(),
          words: new Set(contentWords(`${where} ${sentence}`)),
        }),
      ),
    );
    // Words few sentences contain say more about the question than words every sentence has.
    const idf = (w: string) =>
      Math.log(
        1 +
          candidates.length /
            (1 + candidates.filter((c) => c.words.has(w)).length),
      );
    const scored = candidates
      .map((c) => ({
        ...c,
        matched: asked.filter((w) => c.words.has(w)).length,
        score: asked
          .filter((w) => c.words.has(w))
          .reduce((sum, w) => sum + idf(w), 0),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    // Too little in common with the question to call it an answer.
    const needed = Math.min(2, asked.length);
    if (!best || best.matched < needed) return NO_ANSWER;
    return `${best.sentence} [${best.n}]`;
  });
}
