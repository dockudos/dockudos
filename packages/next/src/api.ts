import {
  type ContentIndex,
  type MarkdownComponents,
  filterIndex,
  hashText,
  scopeFilter,
} from '@dockudos/core';
import { type AccessOptions, authorizePage } from './access.ts';
import {
  type AiOptions,
  createAskHandler,
  createNavigateHandler,
  createGuard,
  preflight,
} from './ai-api.ts';
import { type AuthOptions, createAuthHandlers } from './auth.ts';
import {
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  apiError,
  engineFor,
  inScope,
  json,
  requestScope,
} from './api-common.ts';
import { resolveViewer } from './viewer.ts';
import { createMarkdownHandler } from './markdown.ts';
import { createOgHandler } from './og.ts';
import { createPlaygroundHandler } from './playground-proxy.ts';
import { getSite } from './server.ts';

export interface DocsApiOptions {
  /** How the page route checks `access` rules. Default: the rules of `docs.json`. */
  access?: AccessOptions;
  /** Adapters and environment for the assistant. The settings themselves are the `ai` key of `docs.json`. */
  ai?: AiOptions;
  /** The site's own components, so their `toMarkdown` is used in the Markdown of a page. */
  components?: MarkdownComponents;
  /** Sign-in: where secrets come from, and a `fetch` for the identity provider. */
  auth?: AuthOptions;
}

export type { AiOptions, AuthOptions };
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
 * `GET /api/search?q=…&limit=…&maxPerPage=…&version=…&locale=…` answers `{ hits }` from the built-in keyword engine,
 * for `search.backend: "server"` and for tools that cannot download the index. It searches one version and
 * language (the defaults when not named) and the protected pages the caller may see, and only those.
 */
export function createSearchHandler({ access }: DocsApiOptions = {}) {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').trim();
    if (q.length > MAX_QUERY_LENGTH)
      return apiError(
        400,
        `The query is longer than ${MAX_QUERY_LENGTH} characters.`,
      );
    const site = await getSite();
    const asked = requestScope(site.config, {
      version: params.get('version'),
      locale: params.get('locale'),
    });
    if ('response' in asked) return asked.response;
    const viewer = await resolveViewer(
      request,
      site.config.access.rules,
      access,
    );
    const index = await site.indexFor(viewer);
    const hits = engineFor(index).search(q, {
      limit: integer(params.get('limit'), 10, 1, MAX_LIMIT),
      ...(params.get('maxPerPage') && {
        maxPerPage: integer(params.get('maxPerPage'), 1, 1, MAX_LIMIT),
      }),
      filter: scopeFilter(asked.scope, viewer.canSee),
    });
    return json({ hits }, 200, {
      // What a signed-in reader sees must not be kept for the next visitor.
      'cache-control':
        viewer.scope === ''
          ? 'public, max-age=60, stale-while-revalidate=600'
          : 'private, no-store',
    });
  };
}

const serialized = new WeakMap<
  ContentIndex,
  Map<string, { body: string; etag: string }>
>();

/**
 * `GET /api/search/index?version=…&locale=…` serves the content index for the in-browser engine: one version and
 * language, without vectors (the browser does not need them), and the protected pages the caller may see. Cached by
 * the browser and CDNs and revalidated with an ETag, unless it holds protected pages: then it is private.
 */
export function createIndexHandler({ access }: DocsApiOptions = {}) {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const site = await getSite();
    const asked = requestScope(site.config, {
      version: params.get('version'),
      locale: params.get('locale'),
    });
    if ('response' in asked) return asked.response;
    const viewer = await resolveViewer(
      request,
      site.config.access.rules,
      access,
    );
    const index = await site.indexFor(viewer);
    const key = `${asked.scope.version ?? ''}|${asked.scope.locale ?? ''}`;
    let entries = serialized.get(index);
    if (!entries) serialized.set(index, (entries = new Map()));
    let entry = entries.get(key);
    if (!entry) {
      const { embeddings: _embeddings, ...rest } = filterIndex(
        index,
        inScope(asked.scope),
      );
      entry = {
        body: JSON.stringify({
          ...rest,
          chunks: rest.chunks.map(({ vector: _vector, ...chunk }) => chunk),
        }),
        // Tied to the content, not to the build time, so a rebuild that changed nothing keeps the ETag.
        etag: `"${hashText(rest.pages.map((p) => p.hash).join() + rest.chunks.map((c) => c.id).join())}"`,
      };
      entries.set(key, entry);
    }
    const headers = {
      etag: entry.etag,
      'cache-control':
        viewer.scope === ''
          ? 'public, max-age=300, stale-while-revalidate=3600'
          : 'private, no-cache',
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
export function createPageHandler({ access, components }: DocsApiOptions = {}) {
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
        markdown: await site.markdown(page, components),
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
 * It answers `/api/search`, `/api/search/index`, `/api/page`, `/api/markdown`, `POST /api/ask`, `POST /api/navigate`,
 * `POST /api/playground` (when `openapi.playground.proxy` is on) and the sign-in routes under `/api/auth/` (when
 * `auth` is set); routes you add yourself (such as
 * `/api/kudos`) win over it.
 */
export function createDocsApi(options: DocsApiOptions = {}) {
  const auth = createAuthHandlers(options.auth);
  const get: Record<string, Route> = {
    search: createSearchHandler(options),
    'search/index': createIndexHandler(options),
    'auth/login': auth.login,
    'auth/callback': auth.callback,
    'auth/session': auth.session,
    page: createPageHandler(options),
    markdown: createMarkdownHandler(options),
    og: createOgHandler(),
  };
  // Asking and navigating draw on one budget per visitor.
  const guard = createGuard();
  const post: Record<string, Route> = {
    ask: createAskHandler(options.ai, guard, options.access),
    navigate: createNavigateHandler(options.ai, guard, options.access),
    // Off unless `openapi.playground.proxy` is set in docs.json.
    playground: createPlaygroundHandler(),
    'auth/logout': auth.logout,
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
  // Browsers on other, allowed origins ask before they post.
  const preflights: Record<string, Route> = {
    ask: preflight,
    navigate: preflight,
  };
  return {
    GET: dispatch(get),
    POST: dispatch(post),
    OPTIONS: dispatch(preflights),
  };
}
