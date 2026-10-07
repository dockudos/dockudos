import { getSite } from './server.ts';

/**
 * A `GET` route handler that returns a page as Markdown, for the "Copy page" action:
 *
 *     // src/app/api/markdown/route.ts
 *     export const GET = createMarkdownHandler();
 *
 * Request: `GET /api/markdown?path=/guides/auth`. Hidden pages are served too (their URL works),
 * pages that do not exist answer 404.
 */
export function createMarkdownHandler() {
  return async function GET(request: Request): Promise<Response> {
    const path = new URL(request.url).searchParams.get('path');
    const site = await getSite();
    const page = path
      ? site.tree.pages.find((p) => p.path === path)
      : undefined;
    if (!page) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(await site.markdown(page), {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    });
  };
}
