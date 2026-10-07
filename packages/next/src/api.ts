import {
  type AskEvent,
  type ContentIndex,
  type EmbeddingProvider,
  type FetchLike,
  type LLMProvider,
  AskError,
  KeywordSearch,
  ask,
  createAnswerCache,
  createRateLimiter,
  hashText,
  resolveAiProviders,
  validateAsk,
} from '@dockudos/core';
import { type AccessOptions, authorizePage } from './access.ts';
import { createMarkdownHandler } from './markdown.ts';
import { getSite } from './server.ts';

export const MAX_QUERY_LENGTH = 300;
const MAX_LIMIT = 50;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** A JSON error with a message a person can act on. */
export const apiError = (
  status: number,
  message: string,
  headers: Record<string, string> = {},
) =>
  json({ error: message }, status, { 'cache-control': 'no-store', ...headers });

export interface AiOptions {
  /** A language model of your own, used instead of the one `ai.provider` names. Needed for `"custom"`. */
  llm?: LLMProvider;
  /** Embeddings of your own, used instead of `ai.embeddings`. */
  embeddings?: EmbeddingProvider;
  /** Where API keys are read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

export interface DocsApiOptions {
  /** How the page route checks `access` rules. Default: the rules of `docs.json`. */
  access?: AccessOptions;
  /** Adapters and environment for the assistant. The settings themselves are the `ai` key of `docs.json`. */
  ai?: AiOptions;
}

// One engine per index object: building it is the expensive part of a search.
const engines = new WeakMap<ContentIndex, KeywordSearch>();
export function engineFor(index: ContentIndex): KeywordSearch {
  let engine = engines.get(index);
  if (!engine) engines.set(index, (engine = new KeywordSearch(index)));
  return engine;
}

const integer = (
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/**
 * `GET /api/search?q=…&limit=…&maxPerPage=…` answers `{ hits }` from the built-in keyword engine, for
 * `search.backend: "server"` and for tools that cannot download the index.
 */
export function createSearchHandler() {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').trim();
    if (q.length > MAX_QUERY_LENGTH)
      return apiError(
        400,
        `The query is longer than ${MAX_QUERY_LENGTH} characters.`,
      );
    const index = await (await getSite()).index();
    const hits = engineFor(index).search(q, {
      limit: integer(params.get('limit'), 10, 1, MAX_LIMIT),
      ...(params.get('maxPerPage') && {
        maxPerPage: integer(params.get('maxPerPage'), 1, 1, MAX_LIMIT),
      }),
    });
    return json({ hits }, 200, {
      'cache-control': 'public, max-age=60, stale-while-revalidate=600',
    });
  };
}

const serialized = new WeakMap<ContentIndex, { body: string; etag: string }>();

/**
 * `GET /api/search/index` serves the content index for the in-browser engine: public pages only, without
 * vectors (the browser does not need them). Cached by the browser and CDNs and revalidated with an ETag.
 */
export function createIndexHandler() {
  return async function GET(request: Request): Promise<Response> {
    const index = await (await getSite()).index();
    let entry = serialized.get(index);
    if (!entry) {
      const { embeddings: _embeddings, ...rest } = index;
      entry = {
        body: JSON.stringify({
          ...rest,
          chunks: index.chunks.map(({ vector: _vector, ...chunk }) => chunk),
        }),
        // Tied to the content, not to the build time, so a rebuild that changed nothing keeps the ETag.
        etag: `"${hashText(index.pages.map((p) => p.hash).join() + index.chunks.map((c) => c.id).join())}"`,
      };
      serialized.set(index, entry);
    }
    const headers = {
      etag: entry.etag,
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    };
    if (request.headers.get('if-none-match') === entry.etag)
      return new Response(null, { status: 304, headers });
    return new Response(entry.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...headers,
      },
    });
  };
}

/**
 * `GET /api/page?path=/guides/auth` answers the whole page: `{ path, title, description, headings,
 * markdown }`. Hidden pages are served (their URL works); pages behind an `access` rule need the same
 * credentials as on their own URL.
 */
export function createPageHandler({ access }: DocsApiOptions = {}) {
  return async function GET(request: Request): Promise<Response> {
    const path = new URL(request.url).searchParams.get('path');
    if (!path) return apiError(400, 'Give the page as ?path=/guides/auth.');
    const site = await getSite();
    // Ask for credentials before saying whether the page exists, so the answer does not reveal which
    // protected pages there are.
    const denied = await authorizePage(request, path, {
      rules: site.config.access.rules,
      ...access,
    });
    if (denied) return denied;
    const page = site.tree.pages.find((p) => p.path === path);
    if (!page) return apiError(404, 'No such page.');
    return json(
      {
        path: page.path,
        title: page.title,
        ...(page.description && { description: page.description }),
        headings: await site.toc(page),
        markdown: await site.markdown(page),
      },
      200,
      { 'cache-control': 'public, max-age=60' },
    );
  };
}

const MAX_BODY_BYTES = 32 * 1024;

/**
 * Who is asking, for rate limiting. Takes the address the platform or proxy in front of the site reports.
 * Behind a proxy you do not control, anyone can send these headers; the shared ceiling in `createAskHandler`
 * still caps the total.
 */
export function clientKey(request: Request): string {
  const h = request.headers;
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    h.get('cf-connecting-ip')?.trim() ||
    h.get('x-real-ip')?.trim() ||
    forwarded ||
    'unknown'
  ).slice(0, 64);
}

const sse = (event: AskEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * `POST /api/ask` with `{ question, history? }` streams the answer as server-sent events: `sources`, `token`s,
 * then `done` (or `error`). Requests are limited per visitor and overall, questions and bodies have size
 * caps, and the same question asked again within ten minutes is answered from memory. Needs `ai.enabled`.
 */
export function createAskHandler({
  llm,
  embeddings,
  env = process.env,
  fetch,
}: AiOptions = {}) {
  const cache = createAnswerCache<AskEvent[]>({ max: 200 });
  let limiters:
    | {
        perVisitor: ReturnType<typeof createRateLimiter>;
        overall: ReturnType<typeof createRateLimiter>;
        rate: number;
      }
    | undefined;
  let warned = false;

  return async function POST(request: Request): Promise<Response> {
    const site = await getSite();
    const { ai } = site.config;
    if (!ai.enabled)
      return apiError(
        404,
        'The assistant is not enabled. Set "ai.enabled" in docs.json.',
      );

    const { ratePerMinute } = ai.limits;
    if (limiters?.rate !== ratePerMinute)
      limiters = {
        rate: ratePerMinute,
        perVisitor: createRateLimiter({ limit: ratePerMinute }),
        // A ceiling for the whole site, so spoofed addresses cannot multiply the cost.
        overall: createRateLimiter({ limit: Math.max(60, ratePerMinute * 30) }),
      };
    const turn = limiters.perVisitor.take(clientKey(request));
    const total = limiters.overall.take('all');
    if (!turn.allowed || !total.allowed)
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

    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES)
      return apiError(413, 'The request is too large.');
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES)
      return apiError(413, 'The request is too large.');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, 'The request body is not valid JSON.');
    }
    let question;
    try {
      question = validateAsk(body, ai.limits);
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

type Route = (request: Request) => Promise<Response>;
export type RouteContext = { params: Promise<{ dockudos?: string[] }> };

/**
 * One catch-all route for every dockudos endpoint:
 *
 *     // src/app/api/[...dockudos]/route.ts
 *     import { createDocsApi } from '@dockudos/next/api';
 *     export const { GET, POST } = createDocsApi();
 *
 * It answers `/api/search`, `/api/search/index`, `/api/page`, `/api/markdown` and `POST /api/ask`; routes you add yourself (such as
 * `/api/kudos`) win over it.
 */
export function createDocsApi(options: DocsApiOptions = {}) {
  const get: Record<string, Route> = {
    search: createSearchHandler(),
    'search/index': createIndexHandler(),
    page: createPageHandler(options),
    markdown: createMarkdownHandler(options),
  };
  const post: Record<string, Route> = {
    ask: createAskHandler(options.ai),
  };

  const dispatch =
    (routes: Record<string, Route>) =>
    async (request: Request, { params }: RouteContext): Promise<Response> => {
      const key = ((await params).dockudos ?? []).join('/');
      const route = routes[key];
      if (!route) return apiError(404, 'No such endpoint.');
      try {
        return await route(request);
      } catch (error) {
        console.error('dockudos api:', error);
        return apiError(500, 'Something went wrong.');
      }
    };
  return { GET: dispatch(get), POST: dispatch(post) };
}
