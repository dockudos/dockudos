import {
  type MarkdownComponents,
  buildLlmsFullTxt,
  buildLlmsTxt,
} from '@dockudos/core';
import { requestScope, requestUrl } from './api-common.ts';
import { type Site, getSite } from './server.ts';

/** The version and language an `llms` request asks for (the defaults when it names none). */
function scopeOf(site: Site, request?: Request) {
  const params = requestUrl(request)?.searchParams;
  const asked = requestScope(site.config, {
    version: params?.get('version'),
    locale: params?.get('locale'),
  });
  if ('response' in asked) return asked;
  return { view: site.view(asked.scope) };
}

const headers = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'public, max-age=300',
};

/**
 * `GET` handler for `llms.txt`: an index of the docs for AI tools, each page linked to its Markdown
 * twin. Hidden pages and pages behind an `access` rule are left out. On a site with versions or languages it
 * lists the default ones; `?version=v1&locale=fr` lists another.
 *
 *     // src/app/llms.txt/route.ts
 *     export const dynamic = 'force-static';
 *     export const GET = createLlmsHandler();
 */
export function createLlmsHandler() {
  return async function GET(request?: Request): Promise<Response> {
    const site = await getSite();
    const scoped = scopeOf(site, request);
    if ('response' in scoped) return scoped.response;
    return new Response(buildLlmsTxt(site.config, scoped.view.nav), {
      headers,
    });
  };
}

/** `GET` handler for `llms-full.txt`: the text of every public page in one file. Same exclusions as `llms.txt`. */
export function createLlmsFullHandler({
  components,
}: { components?: MarkdownComponents } = {}) {
  return async function GET(request?: Request): Promise<Response> {
    const site = await getSite();
    const scoped = scopeOf(site, request);
    if ('response' in scoped) return scoped.response;
    return new Response(
      await buildLlmsFullTxt(site.config, scoped.view.nav, (page) =>
        site.markdown(page, components),
      ),
      { headers },
    );
  };
}
