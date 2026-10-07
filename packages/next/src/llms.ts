import { buildLlmsFullTxt, buildLlmsTxt } from '@dockudos/core';
import { getSite } from './server.ts';

const headers = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'public, max-age=300',
};

/**
 * `GET` handler for `llms.txt`: an index of the docs for AI tools, each page linked to its Markdown
 * twin. Hidden pages and pages behind an `access` rule are left out.
 *
 *     // src/app/llms.txt/route.ts
 *     export const dynamic = 'force-static';
 *     export const GET = createLlmsHandler();
 */
export function createLlmsHandler() {
  return async function GET(): Promise<Response> {
    const { config, nav } = await getSite();
    return new Response(buildLlmsTxt(config, nav), { headers });
  };
}

/** `GET` handler for `llms-full.txt`: the text of every public page in one file. Same exclusions as `llms.txt`. */
export function createLlmsFullHandler() {
  return async function GET(): Promise<Response> {
    const site = await getSite();
    return new Response(
      await buildLlmsFullTxt(site.config, site.nav, (page) =>
        site.markdown(page),
      ),
      { headers },
    );
  };
}
