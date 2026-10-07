import {
  type AskEvent,
  type DocsConfig,
  type EmbeddingProvider,
  type FetchLike,
  type LLMProvider,
  type NavigateResult,
  AskError,
  ask,
  checkToken,
  createAnswerCache,
  createRateLimiter,
  hashText,
  bearerToken,
  navigate,
  parseTokens,
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

/** An API key's budget, as a multiple of a visitor's. */
const KEY_BUDGET = 6;

type Limiters = {
  perVisitor: ReturnType<typeof createRateLimiter>;
  perKey: ReturnType<typeof createRateLimiter>;
  overall: ReturnType<typeof createRateLimiter>;
  rate: number;
};

/** The request budget shared by the AI routes of one API. */
export interface Guard {
  /**
   * Take one request from a caller's budget (an address, or an API key). Returns the response to send when it is
   * spent.
   */
  take(caller: Caller, ratePerMinute: number): Response | undefined;
}

export function createGuard(): Guard {
  let limiters: Limiters | undefined;
  return {
    take(caller, ratePerMinute) {
      if (limiters?.rate !== ratePerMinute)
        limiters = {
          rate: ratePerMinute,
          perVisitor: createRateLimiter({ limit: ratePerMinute }),
          // A caller with an API key is trusted with more, each key counted on its own.
          perKey: createRateLimiter({ limit: ratePerMinute * KEY_BUDGET }),
          // A ceiling for the whole site, so spoofed addresses cannot multiply the cost.
          overall: createRateLimiter({
            limit: Math.max(60, ratePerMinute * 30),
          }),
        };
      const turn = (caller.keyed ? limiters.perKey : limiters.perVisitor).take(
        caller.bucket,
      );
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

/** Who is calling, for the budget and for CORS. */
export interface Caller {
  /** The key the budget is counted under: the visitor's address, or the hash of the API key. */
  bucket: string;
  /** The caller showed a valid API key. */
  keyed: boolean;
  /** Set when a browser on another, allowed, origin is calling: CORS headers go back to it. */
  cors?: string;
}

const hostOf = (value: string | null | undefined) => {
  try {
    return value ? new URL(value).host : '';
  } catch {
    return '';
  }
};

/**
 * Decide who is calling and whether they may. Same-site browsers and callers without an `Origin` (servers, tools)
 * are let in; a browser on another origin only if `ai.allowedOrigins` lists it. An API key (`Authorization:
 * Bearer`, or `x-api-key`) from `DOCKUDOS_API_KEYS` gets its own, larger budget; a wrong one is refused.
 */
export function identify(
  request: Request,
  ai: Pick<DocsConfig['ai'], 'allowedOrigins'>,
  siteUrl: string | undefined,
  env: Record<string, string | undefined>,
): Caller | Response {
  const given =
    bearerToken(request.headers.get('authorization')) ??
    request.headers.get('x-api-key') ??
    undefined;
  let keyed = false;
  if (given) {
    if (!checkToken(given, parseTokens(env['DOCKUDOS_API_KEYS'])))
      return apiError(401, 'The API key is not valid.', {
        'www-authenticate': 'Bearer',
      });
    keyed = true;
  }

  const origin = request.headers.get('origin');
  let cors: string | undefined;
  if (origin) {
    const own = [
      new URL(request.url).host,
      request.headers.get('x-forwarded-host'),
      request.headers.get('host'),
      hostOf(siteUrl),
    ];
    if (ai.allowedOrigins.includes(origin)) cors = origin;
    // An origin that is not a URL (`null`, from a sandboxed frame) has no host and matches nothing.
    else if (!hostOf(origin) || !own.includes(hostOf(origin)))
      return apiError(
        403,
        'This origin may not use the assistant. Add it to "ai.allowedOrigins" in docs.json.',
      );
  }
  return {
    bucket: keyed ? `key:${hashText(given as string)}` : clientKey(request),
    keyed,
    ...(cors && { cors }),
  };
}

/** Add the headers that let an allowed origin read the response. */
export function withCors(
  response: Response,
  cors: string | undefined,
): Response {
  if (!cors) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', cors);
  headers.set('access-control-expose-headers', 'retry-after');
  headers.append('vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

/** The answer to a browser's preflight: allowed for the listed origins, a clear refusal for the rest. */
export async function preflight(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  const { ai } = (await getSite()).config;
  if (!ai.enabled || !origin || !ai.allowedOrigins.includes(origin))
    return apiError(
      403,
      'This origin may not use the assistant. Add it to "ai.allowedOrigins" in docs.json.',
    );
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-api-key',
      'access-control-max-age': '600',
      vary: 'Origin',
    },
  });
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

    const caller = identify(request, ai, site.config.seo.siteUrl, env);
    if (caller instanceof Response) return caller;
    const reply = (response: Response) => withCors(response, caller.cors);

    const spent = guard.take(caller, ai.limits.ratePerMinute);
    if (spent) return reply(spent);

    const read = await readBody(request);
    if ('response' in read) return reply(read.response);
    let question;
    try {
      question = validateAsk(read.body, ai.limits);
    } catch (error) {
      if (error instanceof AskError)
        return reply(apiError(error.status, error.message));
      throw error;
    }

    const cacheKey = question.history?.length
      ? undefined
      : hashText(
          [
            question.question.toLowerCase().replace(/\s+/g, ' '),
            question.locale,
            question.version,
            JSON.stringify(question.context ?? null),
          ].join('\u0000'),
        );
    const headers = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    };
    const encoder = new TextEncoder();
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    if (cached)
      return reply(new Response(cached.map(sse).join(''), { headers }));

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
    return reply(
      new Response(
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
      ),
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

    const caller = identify(request, ai, site.config.seo.siteUrl, env);
    if (caller instanceof Response) return caller;
    const reply = (response: Response) => withCors(response, caller.cors);

    const spent = guard.take(caller, ai.limits.ratePerMinute);
    if (spent) return reply(spent);

    const read = await readBody(request);
    if ('response' in read) return reply(read.response);
    let query;
    try {
      query = validateNavigate(read.body, ai.limits);
    } catch (error) {
      if (error instanceof AskError)
        return reply(apiError(error.status, error.message));
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
        if (request.signal.aborted) return reply(apiError(499, 'Cancelled.'));
        console.error('dockudos navigate:', error);
        return reply(
          apiError(500, 'Could not find a page. Try again in a moment.'),
        );
      }
      cache.set(key, result);
    }
    if (!result)
      return reply(apiError(404, 'Nothing in the docs matches that.'));
    return reply(json(result, 200, { 'cache-control': 'no-store' }));
  };
}
