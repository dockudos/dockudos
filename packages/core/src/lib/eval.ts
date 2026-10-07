import type { EmbeddingProvider, LLMProvider } from './ai-provider.ts';
import { type AskEvent, type AskLimits, ask } from './ask.ts';
import type { ContentIndex } from './content-index.ts';
import type { KeywordSearch } from './keyword-search.ts';
import { navigate } from './navigate.ts';
import { retrieve } from './retrieval.ts';

/**
 * Questions with known answers, for checking the assistant of a site. A place is a page path (`/guides/billing`) or a
 * section (`/guides/billing#invoices`); a page path matches any section of that page.
 */
export interface EvalSet {
  /** Questions the docs answer, with the places that answer them. */
  questions: { id: string; question: string; expect: string[] }[];
  /** Questions the docs do not answer: off topic, or about something the product does not do. */
  unanswerable: { id: string; question: string }[];
  /** Requests for a place, and the places that are right for them (any one will do). */
  navigation: { id: string; query: string; expect: string | string[] }[];
}

export interface EvalDeps {
  siteName: string;
  index: ContentIndex;
  keyword: KeywordSearch;
  limits: AskLimits;
  /** Without a model the answer cases are skipped and navigation runs on search alone. */
  llm?: LLMProvider;
  embeddings?: EmbeddingProvider;
  /** How many retrieved chunks count for the hit rate. Default 5. */
  topK?: number;
}

export interface Rate {
  /** Share of cases that passed, 0 to 1. */
  rate: number;
  passed: number;
  total: number;
  /** Ids of the cases that failed. */
  failed: string[];
}

export interface EvalReport {
  /** Did the right page appear among the top chunks? */
  retrieval: Rate;
  citations: {
    /** Share of citations that name a source the model was given and that resolves to a real page and heading. */
    validity: number;
    cited: number;
    invalid: number;
    /** Answers that cited nothing. */
    uncited: string[];
  };
  /** Questions answered when the docs have the answer, refused when they do not. */
  refusals: Rate;
  navigation: {
    /** Chosen by search alone. */
    search: Rate;
    /** Chosen by the model, when there is one. */
    model?: Rate;
  };
  /**
   * Time from asking to the first piece of the answer, in ms, over the questions that were answered. Only worth reading
   * with a real model: a stand-in answers at once.
   */
  firstToken?: { p50: number; p95: number };
}

const matches = (url: string, expected: string) =>
  expected.includes('#') ? url === expected : url.split('#')[0] === expected;

const rate = (results: { id: string; ok: boolean }[]): Rate => {
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const passed = results.length - failed.length;
  return {
    rate: results.length ? passed / results.length : 1,
    passed,
    total: results.length,
    failed,
  };
};

async function collect(
  events: AsyncIterable<AskEvent>,
  firstToken?: number[],
): Promise<AskEvent[]> {
  const out: AskEvent[] = [];
  const start = performance.now();
  for await (const e of events) {
    if (
      e.type === 'token' &&
      firstToken &&
      !out.some((x) => x.type === 'token')
    )
      firstToken.push(performance.now() - start);
    out.push(e);
  }
  return out;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;

/**
 * Run an evaluation set against a site's index and model. Retrieval and navigation need no model; the rest does.
 * Returns the numbers CI tracks: hit rate, citation validity, refusal accuracy and navigation accuracy.
 */
export async function runEval(
  deps: EvalDeps,
  set: EvalSet,
): Promise<EvalReport> {
  const topK = deps.topK ?? 5;
  const pages = new Map(deps.index.pages.map((p) => [p.path, p]));

  // 1. Retrieval: the expected place is among the top chunks.
  const retrieval = rate(
    await Promise.all(
      set.questions.map(async ({ id, question, expect }) => {
        const { chunks } = await retrieve(question, deps.index, deps.keyword, {
          limit: topK,
          embeddings: deps.embeddings,
        });
        const urls = chunks.map((c) =>
          c.chunk.anchor ? `${c.page.path}#${c.chunk.anchor}` : c.page.path,
        );
        return { id, ok: expect.some((e) => urls.some((u) => matches(u, e))) };
      }),
    ),
  );

  // 2. Answers: citations are valid, and questions are answered or refused as they should be.
  let cited = 0;
  let invalid = 0;
  const uncited: string[] = [];
  const refusalResults: { id: string; ok: boolean }[] = [];
  const firstTokens: number[] = [];
  if (deps.llm) {
    const askDeps = {
      siteName: deps.siteName,
      index: deps.index,
      keyword: deps.keyword,
      llm: deps.llm,
      embeddings: deps.embeddings,
      limits: deps.limits,
    };
    for (const { id, question } of set.questions) {
      const events = await collect(ask(askDeps, { question }), firstTokens);
      const sources = events.find((e) => e.type === 'sources');
      const done = events.find((e) => e.type === 'done');
      const answered = done?.type === 'done' && !done.refused;
      refusalResults.push({ id, ok: answered });
      if (answered && done.type === 'done') {
        if (done.citations.length === 0) uncited.push(id);
        for (const n of done.citations) {
          cited++;
          const source =
            sources?.type === 'sources'
              ? sources.items.find((s) => s.n === n)
              : undefined;
          const page = source ? pages.get(source.path) : undefined;
          const resolves =
            !!source &&
            !!page &&
            (source.anchor === '' ||
              page.headings.some((h) => h.id === source.anchor));
          if (!resolves) invalid++;
        }
        // Every [n] in the text must be one of the citations.
        const text = events
          .flatMap((e) => (e.type === 'token' ? [e.text] : []))
          .join('');
        for (const m of text.matchAll(/\[(\d+)\]/g))
          if (!done.citations.includes(Number(m[1]))) {
            cited++;
            invalid++;
          }
      }
    }
    for (const { id, question } of set.unanswerable) {
      const events = await collect(ask(askDeps, { question }));
      const done = events.find((e) => e.type === 'done');
      refusalResults.push({ id, ok: done?.type === 'done' && !!done.refused });
    }
  }

  // 3. Navigation, by search alone and by the model.
  const base = {
    index: deps.index,
    keyword: deps.keyword,
    embeddings: deps.embeddings,
  };
  const target = async (llm: LLMProvider | undefined) =>
    rate(
      await Promise.all(
        set.navigation.map(async ({ id, query, expect }) => {
          const result = await navigate({ ...base, llm }, { query });
          const accepted = Array.isArray(expect) ? expect : [expect];
          return {
            id,
            ok: !!result && accepted.some((e) => matches(result.url, e)),
          };
        }),
      ),
    );

  return {
    retrieval,
    citations: {
      validity: cited ? (cited - invalid) / cited : 1,
      cited,
      invalid,
      uncited,
    },
    refusals: rate(refusalResults),
    ...(firstTokens.length && {
      firstToken: {
        p50: percentile(
          firstTokens.sort((a, b) => a - b),
          0.5,
        ),
        p95: percentile(firstTokens, 0.95),
      },
    }),
    navigation: {
      search: await target(undefined),
      ...(deps.llm && { model: await target(deps.llm) }),
    },
  };
}

/** The numbers worth tracking from run to run, flat. */
export function evalMetrics(report: EvalReport): Record<string, number> {
  return {
    retrievalHitRate: report.retrieval.rate,
    citationValidity: report.citations.validity,
    refusalAccuracy: report.refusals.rate,
    navigationAccuracySearch: report.navigation.search.rate,
    ...(report.navigation.model && {
      navigationAccuracyModel: report.navigation.model.rate,
    }),
  };
}

/**
 * Compare a run with the numbers it must not fall below. Citation validity must be exactly 1; every other metric
 * must be at least as good as the baseline. Returns what got worse, empty when all is well.
 */
export function evalRegressions(
  metrics: Record<string, number>,
  baseline: Record<string, number>,
): string[] {
  const problems: string[] = [];
  if ((metrics['citationValidity'] ?? 1) < 1)
    problems.push(
      `citationValidity is ${metrics['citationValidity']}, it must be 1`,
    );
  for (const [name, floor] of Object.entries(baseline)) {
    if (name === 'citationValidity') continue;
    const now = metrics[name];
    if (now === undefined) problems.push(`${name} was not measured`);
    else if (now < floor - 1e-9)
      problems.push(`${name} fell from ${floor} to ${now}`);
  }
  return problems;
}
