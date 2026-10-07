import {
  createDocsBackend,
  createMcpServer,
  createRateLimiter,
  mcpParseError,
  publicPages,
} from '@dockudos/core';
import { type AccessOptions, authorizePage } from './access.ts';
import {
  MAX_BODY_BYTES,
  apiError,
  clientKey,
  engineFor,
} from './api-common.ts';
import { getSite } from './server.ts';

/** The version of this MCP server's interface, as clients see it. Not the version of dockudos. */
export const MCP_SERVER_VERSION = '1';

export interface McpHandlerOptions {
  /** How `get_page` checks `access` rules. Default: the rules of `docs.json`. */
  access?: AccessOptions;
  /**
   * Origins, besides the site itself, that may call the route from a browser (`https://app.example.com`).
   * Requests without an `Origin` header, which is how coding tools call, are always accepted.
   */
  allowedOrigins?: readonly string[];
  /** Requests per visitor per minute. Default 120. */
  ratePerMinute?: number;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/**
 * A Model Context Protocol server for the docs, over Streamable HTTP, for coding tools that read documentation:
 *
 *     // src/app/mcp/route.ts
 *     import { createMcpHandler } from '@dockudos/next/mcp';
 *     export const { POST, GET, DELETE } = createMcpHandler();
 *
 * Tools: `search_docs`, `get_page`, `list_pages`. Searching and listing see public pages only; `get_page` also
 * reads hidden pages, and a page behind an `access` rule only with the credentials that rule asks for. The route
 * refuses browser requests from other origins, and limits and caps what it accepts.
 */
export function createMcpHandler({
  access,
  allowedOrigins = [],
  ratePerMinute = 120,
}: McpHandlerOptions = {}) {
  const limiter = createRateLimiter({ limit: ratePerMinute });

  async function POST(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin) {
      const allowed = [new URL(request.url).host, request.headers.get('host')];
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        /* not a URL: refused below */
      }
      if (!allowed.includes(host) && !allowedOrigins.includes(origin))
        return apiError(
          403,
          'This origin may not use the documentation server.',
        );
    }

    const turn = limiter.take(clientKey(request));
    if (!turn.allowed)
      return apiError(
        429,
        `Too many requests. Try again in ${turn.retryAfter} seconds.`,
        {
          'retry-after': String(turn.retryAfter),
        },
      );

    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
      return apiError(413, 'The request is too large.');
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES)
      return apiError(413, 'The request is too large.');
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify(mcpParseError()), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const site = await getSite();
    const index = await site.index();
    const rules = { rules: site.config.access.rules, ...access };
    const byPath = new Map(site.tree.pages.map((p) => [p.path, p]));
    const server = createMcpServer(
      {
        name: `${site.config.name} documentation`,
        version: MCP_SERVER_VERSION,
        instructions: `Search and read the documentation of ${site.config.name}. Use search_docs to find sections, then get_page for a whole page.`,
      },
      createDocsBackend({
        search: (query, { limit }) =>
          engineFor(index).search(query, { limit, maxPerPage: 2 }),
        pages: site.tree.pages,
        listed: publicPages(site.config, site.nav).map(({ page }) => ({
          path: page.path,
          title: page.title,
          ...(page.description && { description: page.description }),
        })),
        markdown: (path) => {
          const page = byPath.get(path);
          return page ? site.markdown(page) : '';
        },
        isProtected: (path) => {
          const page = byPath.get(path);
          return page ? site.isProtected(page) : false;
        },
        authorize: async (path) =>
          (await authorizePage(request, path, rules)) === undefined,
      }),
    );

    const reply = await server.handle(message);
    // Notifications and responses get an empty "accepted".
    if (reply === undefined) return new Response(null, { status: 202 });
    return new Response(JSON.stringify(reply), { headers: JSON_HEADERS });
  }

  // This server does not stream to the client and keeps no sessions.
  const notAllowed = () =>
    new Response('Use POST.', {
      status: 405,
      headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' },
    });

  return { POST, GET: notAllowed, DELETE: notAllowed };
}
