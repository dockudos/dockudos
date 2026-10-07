import {
  type AskEvent,
  type EmbeddingProvider,
  type FetchLike,
  type LLMProvider,
  type NavigateResult,
  AskError,
  ask,
  createAnswerCache,
  createRateLimiter,
  hashText,
  navigate,
  resolveAiProviders,
  validateAsk,
  validateNavigate,
} from '@dockudos/core';
import {
  MAX_BODY_BYTES,
  apiError,
  clientKey,
  engineFor,
  json,
} from './api-common.ts';
import { getSite } from './server.ts';

export interface AiOptions {
  /** A language model of your own, used instead of the one `ai.provider` names. Needed for `"custom"`. */
  llm?: LLMProvider;
  /** Embeddings of your own, used instead of `ai.embeddings`. */
  embeddings?: EmbeddingProvider;
  /** Where API keys are read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

type Limiters = {
  perVisitor: ReturnType<typeof createRateLimiter>;
  overall: ReturnType<typeof createRateLimiter>;
  rate: number;
};

/** The request budget shared by the AI routes of one API. */
export interface Guard {
  /** Take one request from the visitor's budget. Returns the response to send when it is spent. */
  take(request: Request, ratePerMinute: number): Response | undefined;
}

export function createGuard(): Guard {
  let limiters: Limiters | undefined;
  return {
    take(request, ratePerMinute) {
      if (limiters?.rate !== ratePerMinute)
        limiters = {
          rate: ratePerMinute,
          perVisitor: createRateLimiter({ limit: ratePerMinute }),
          // A ceiling for the whole site, so spoofed addresses cannot multiply the cost.
          overall: createRateLimiter({
            limit: Math.max(60, ratePerMinute * 30),
          }),
        };
      const turn = limiters.perVisitor.take(clientKey(request));
      const total = limiters.overall.take('all');
      if (turn.allowed && total.allowed) return undefined;
      return apiError(
        429,
        turn.allowed
          ? 'The assistant is busy. Try again in a moment.'
          : `Too many questions. Try again in ${turn.retryAfter} seconds.`,
        {
          'retry-after': String(
            turn.allowed ? total.retryAfter : turn.retryAfter,
          ),
        },
      );
    },
  };
}

/** Read a JSON body, refusing what is too big or not JSON with a status and a message. */
async function readBody(
  request: Request,
): Promise<{ body: unknown } | { response: Response }> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES)
    return { response: apiError(413, 'The request is too large.') };
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    return { response: apiError(413, 'The request is too large.') };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { response: apiError(400, 'The request body is not valid JSON.') };
  }
}

const sse = (event: AskEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * `POST /api/ask` with `{ question, history? }` streams the answer as server-sent events: `sources`, `token`s,
 * then `done` (or `error`). Requests are limited per visitor and overall, questions and bodies have size
 * caps, and the same question asked again within ten minutes is answered from memory. Needs `ai.enabled`.
 */
export function createAskHandler(
  { llm, embeddings, env = process.env, fetch }: AiOptions = {},
  guard: Guard = createGuard(),
) {
  const cache = createAnswerCache<AskEvent[]>({ max: 200 });
  let warned = false;

  return async function POST(request: Request): Promise<Response> {
    const site = await getSite();
    const { ai } = site.config;
    if (!ai.enabled)
      return apiError(
        404,
        'The assistant is not enabled. Set "ai.enabled" in docs.json.',
      );

    const spent = guard.take(request, ai.limits.ratePerMinute);
    if (spent) return spent;

    const read = await readBody(request);
    if ('response' in read) return read.response;
    let question;
    try {
      question = validateAsk(read.body, ai.limits);
    } catch (error) {
      if (error instanceof AskError)
        return apiError(error.status, error.message);
      throw error;
    }

    const cacheKey = question.history?.length
      ? undefined
      : hashText(
          [
            question.question.toLowerCase().replace(/\s+/g, ' '),
            question.locale,
            question.version,
          ].join('\u0000'),
        );
    const headers = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    };
    const encoder = new TextEncoder();
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    if (cached) return new Response(cached.map(sse).join(''), { headers });

    const resolved = resolveAiProviders(ai, { env, llm, embeddings, fetch });
    if (!warned && resolved.problems.length) {
      warned = true;
      for (const problem of resolved.problems)
        console.warn(`dockudos: ${problem}`);
    }
    const index = await site.index();
    const events = ask(
      {
        siteName: site.config.name,
        index,
        keyword: engineFor(index),
        llm: resolved.llm,
        embeddings: resolved.embeddings,
        limits: ai.limits,
      },
      question,
      request.signal,
    );

    const seen: AskEvent[] = [];
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { value, done } = await events.next();
          if (done) {
            const last = seen.at(-1);
            if (
              cacheKey &&
              last?.type === 'done' &&
              last.refused !== 'no-llm' &&
              last.flagged === undefined
            ) {
              // Replay as one piece of text: a cached answer needs no typing effect.
              const text = seen
                .flatMap((e) => (e.type === 'token' ? [e.text] : []))
                .join('');
              cache.set(cacheKey, [
                ...seen.filter((e) => e.type === 'sources'),
                { type: 'token', text },
                last,
              ]);
            }
            controller.close();
            return;
          }
          seen.push(value);
          controller.enqueue(encoder.encode(sse(value)));
        },
        async cancel() {
          await events.return(undefined);
        },
      }),
      { headers },
    );
  };
}

/**
 * `POST /api/navigate` with `{ query }` answers `{ path, anchor?, url, title, headingPath, reason, confidence,
 * alternatives? }`: the one place in the docs the request is about. A language model chooses among the best
 * search results when there is one; without a key the best result is the answer. `confidence: "low"` means
 * the reader should be shown the choices. Answers 404 when nothing relates to the request. Needs `ai.enabled`
 * (and `ai.navigation`); shares the visitor's budget with `/api/ask`.
 */
export function createNavigateHandler(
  { llm, embeddings, env = process.env, fetch }: AiOptions = {},
  guard: Guard = createGuard(),
) {
  const cache = createAnswerCache<NavigateResult | null>({
    max: 200,
    ttlMs: 5 * 60_000,
  });
  let warned = false;

  return async function POST(request: Request): Promise<Response> {
    const site = await getSite();
    const { ai } = site.config;
    if (!ai.enabled || !ai.navigation)
      return apiError(
        404,
        'Navigation by request is not enabled. Set "ai.enabled" in docs.json.',
      );

    const spent = guard.take(request, ai.limits.ratePerMinute);
    if (spent) return spent;

    const read = await readBody(request);
    if ('response' in read) return read.response;
    let query;
    try {
      query = validateNavigate(read.body, ai.limits);
    } catch (error) {
      if (error instanceof AskError)
        return apiError(error.status, error.message);
      throw error;
    }

    const key = hashText(
      [
        query.query.toLowerCase().replace(/\s+/g, ' '),
        query.locale,
        query.version,
      ].join('\u0000'),
    );
    let result = cache.get(key);
    if (result === undefined) {
      const resolved = resolveAiProviders(ai, { env, llm, embeddings, fetch });
      if (!warned && resolved.problems.length) {
        warned = true;
        for (const problem of resolved.problems)
          console.warn(`dockudos: ${problem}`);
      }
      const index = await site.index();
      try {
        result =
          (await navigate(
            {
              index,
              keyword: engineFor(index),
              llm: resolved.llm,
              embeddings: resolved.embeddings,
            },
            query,
            request.signal,
          )) ?? null;
      } catch (error) {
        if (request.signal.aborted) return apiError(499, 'Cancelled.');
        console.error('dockudos navigate:', error);
        return apiError(500, 'Could not find a page. Try again in a moment.');
      }
      cache.set(key, result);
    }
    if (!result) return apiError(404, 'Nothing in the docs matches that.');
    return json(result, 200, { 'cache-control': 'no-store' });
  };
}
