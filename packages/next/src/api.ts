import { type ContentIndex, hashText } from '@dockudos/core';
import { type AccessOptions, authorizePage } from './access.ts';
import {
  type AiOptions,
  createAskHandler,
  createNavigateHandler,
  createGuard,
} from './ai-api.ts';
import {
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  apiError,
  engineFor,
  json,
} from './api-common.ts';
import { createMarkdownHandler } from './markdown.ts';
import { getSite } from './server.ts';

export interface DocsApiOptions {
  /** How the page route checks `access` rules. Default: the rules of `docs.json`. */
  access?: AccessOptions;
  /** Adapters and environment for the assistant. The settings themselves are the `ai` key of `docs.json`. */
  ai?: AiOptions;
}

export type { AiOptions };
export { apiError, json, clientKey } from './api-common.ts';
export { createAskHandler, createNavigateHandler } from './ai-api.ts';

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

type Route = (request: Request) => Promise<Response>;
export type RouteContext = { params: Promise<{ dockudos?: string[] }> };

/**
 * One catch-all route for every dockudos endpoint:
 *
 *     // src/app/api/[...dockudos]/route.ts
 *     import { createDocsApi } from '@dockudos/next/api';
 *     export const { GET, POST } = createDocsApi();
 *
 * It answers `/api/search`, `/api/search/index`, `/api/page`, `/api/markdown`, `POST /api/ask` and `POST /api/navigate`; routes you add yourself (such as
 * `/api/kudos`) win over it.
 */
export function createDocsApi(options: DocsApiOptions = {}) {
  const get: Record<string, Route> = {
    search: createSearchHandler(),
    'search/index': createIndexHandler(),
    page: createPageHandler(options),
    markdown: createMarkdownHandler(options),
  };
  // Asking and navigating draw on one budget per visitor.
  const guard = createGuard();
  const post: Record<string, Route> = {
    ask: createAskHandler(options.ai, guard),
    navigate: createNavigateHandler(options.ai, guard),
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
