import {
  OG_SIZE,
  normalizePath,
  ogElement,
  pathFromOgImage,
  versionInfos,
} from '@dockudos/core';
import { ImageResponse } from 'next/og.js';
import { getSite } from './server.ts';

/**
 * `GET` handler for the social-card image of a page, `/og/guides/auth.png` (the home page is `/og/index.png`).
 * `withDocs()` rewrites those addresses here and `pageMetadata()` points `og:image` at them.
 *
 *     // src/app/api/og/route.ts   (or let createDocsApi() answer /api/og)
 *     export const GET = createOgHandler();
 *
 * The card shows the site name, the page's title and description, and its version, on the theme's brand color. A
 * page behind an `access` rule gets a card with the site's name only, so the image reveals nothing about it.
 * Text is drawn with the font that ships with `next/og`, which covers Latin scripts.
 */
export function createOgHandler() {
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const site = await getSite();
    const requested =
      pathFromOgImage(normalizePath(url.pathname) ?? '') ??
      url.searchParams.get('path') ??
      undefined;
    const page = requested
      ? site.tree.pages.find((p) => p.path === requested)
      : undefined;
    if (!page || page.hidden)
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });

    const open = !site.isProtected(page);
    const version = versionInfos(site.config).find(
      (v) => v.name === page.version,
    );
    const element = ogElement({
      siteName: site.config.name,
      title: open ? page.title : site.config.name,
      ...(open && page.description && { description: page.description }),
      ...(open && version && { badge: version.label }),
      primary: site.config.theme.primary,
    });
    // `ImageResponse` takes React elements; a plain `{ type, props }` tree is what they are made of.
    const image = new ImageResponse(element as never, OG_SIZE);
    image.headers.set(
      'cache-control',
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    );
    return image;
  };
}
