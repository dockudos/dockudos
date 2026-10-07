import { normalizePath, resolveTwinTarget } from '@dockudos/core';
import { type AccessOptions, authorizePage } from './access.ts';
import { getSite } from './server.ts';

/**
 * The page a request asks for: `?path=/guides/auth` when given, else the address the request was made
 * to, without `.md`. Rewrites (`/guides/auth.md`, `Accept: text/markdown`) keep the original address.
 */
function requestedPath(request: Request): string | undefined {
  const url = new URL(request.url);
  const given = url.searchParams.get('path');
  if (given !== null) return given || undefined;
  return normalizePath(url.pathname.replace(/\.md$/, ''));
}

/**
 * A `GET` route handler that returns a page as Markdown:
 *
 *     // src/app/api/markdown/route.ts
 *     export const GET = createMarkdownHandler();
 *
 * Request: `GET /api/markdown?path=/guides/auth`, or any address ending in `.md`. It serves the "Copy page" action, the `.md` twin of every
 * page (`/guides/auth.md`) and requests that ask for `text/markdown`; `withDocs()` rewrites those here.
 * Hidden pages are served too (their URL works), pages that do not exist answer 404. A page covered by an
 * `access` rule needs the same credentials here as on its own URL.
 */
export function createMarkdownHandler({
  access,
}: { access?: AccessOptions } = {}) {
  return async function GET(request: Request): Promise<Response> {
    const requested = requestedPath(request);
    const site = await getSite();
    const options = { rules: site.config.access.rules, ...access };
    // Ask for credentials before saying whether the page exists, so the answer does not reveal which
    // protected pages there are.
    if (requested) {
      const denied = await authorizePage(request, requested, options);
      if (denied) return denied;
    }
    const path = requested
      ? resolveTwinTarget(site.tree.pages, requested)
      : undefined;
    const page = path
      ? site.tree.pages.find((p) => p.path === path)
      : undefined;
    if (!page) {
      return new Response('Not found', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          vary: 'Accept',
        },
      });
    }
    // `/index` is the home page, which a rule for `/` covers: check the page's own path too.
    if (page.path !== requested) {
      const denied = await authorizePage(request, page.path, options);
      if (denied) return denied;
    }
    return new Response(await site.markdown(page), {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=60',
        vary: 'Accept',
      },
    });
  };
}
