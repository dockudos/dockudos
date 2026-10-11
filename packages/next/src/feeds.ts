import {
  type FeedItem,
  type MarkdownComponents,
  buildRss,
  canonicalUrl,
  extractUpdates,
  mdxToMarkdown,
  sortNewestFirst,
} from '@dockudos/core';
import { requestScope, requestUrl } from './api-common.ts';
import { type Site, getSite } from './server.ts';
import { defineMdxComponents } from './mdx-components.ts';

const headers = {
  'content-type': 'application/rss+xml; charset=utf-8',
  'cache-control': 'public, max-age=300',
};

const notFound = (message: string) =>
  new Response(message, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

/** A feed item's text must stay short: readers show a teaser and link to the page. */
const teaser = (text: string, max = 2000) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

const FEED_PATH = { changelog: '/changelog.xml', posts: '/rss.xml' } as const;

export interface FeedHandlerOptions {
  /** The site's own components, so their `toMarkdown` is used in the text of an entry. */
  components?: MarkdownComponents;
}

/**
 * `GET` handler for an RSS 2.0 feed:
 *
 *     // src/app/changelog.xml/route.ts
 *     export const GET = createFeedHandler('changelog');
 *     // src/app/rss.xml/route.ts
 *     export const GET = createFeedHandler('posts');
 *
 * `changelog` has one item per `<Update>` on the page named by `changelog.path`, linking to the entry; `posts` has one
 * item per page with a `date` in its frontmatter. Needs `seo.siteUrl` (items must have absolute links) and the
 * feed turned on in `feeds`. Pages behind an `access` rule, hidden pages and untranslated stand-ins are never in
 * a feed. `?version=` and `?locale=` pick another version or language than the defaults.
 */
export function createFeedHandler(
  kind: 'changelog' | 'posts',
  { components }: FeedHandlerOptions = {},
) {
  return async function GET(request?: Request): Promise<Response> {
    const site = await getSite();
    const { config } = site;
    if (!config.feeds[kind])
      return notFound(
        `The ${kind} feed is off. Set "feeds.${kind}" to true in docs.json.`,
      );
    const siteUrl = config.seo.siteUrl;
    if (!siteUrl)
      return notFound(
        'Feeds need absolute links. Set "seo.siteUrl" in docs.json.',
      );
    const url = requestUrl(request);
    const params = url?.searchParams ?? new URLSearchParams();
    const asked = requestScope(config, {
      version: params.get('version'),
      locale: params.get('locale'),
    });
    if ('response' in asked) return asked.response;

    const channel =
      kind === 'changelog'
        ? await changelogChannel(site, asked.scope, siteUrl, components)
        : postsChannel(site, asked.scope, siteUrl);
    if (!channel) return notFound('There is nothing to put in this feed.');
    const self =
      canonicalUrl(siteUrl, url?.pathname ?? FEED_PATH[kind]) +
      (params.size ? `?${params}` : '');
    return new Response(
      buildRss({
        ...channel,
        self,
        language: asked.scope.locale,
        limit: config.feeds.limit,
      }),
      { headers },
    );
  };
}

async function changelogChannel(
  site: Site,
  scope: { locale?: string; version?: string },
  siteUrl: string,
  components: MarkdownComponents | undefined,
) {
  const found = site.finder(scope, site.config.changelog.path);
  const page = found && site.tree.pages.find((p) => p.path === found.path);
  // A protected changelog is not in a public feed, and the feed does not say that it exists.
  if (!page || site.isProtected(page) || page.fallbackLocale) return undefined;
  const link = canonicalUrl(siteUrl, page.path);
  const entries = extractUpdates(await site.source(page));
  const items: FeedItem[] = await Promise.all(
    entries.map(async (entry) => {
      const body = await mdxToMarkdown(entry.body, {
        components: { ...defineMdxComponents(), ...components },
      });
      return {
        title: entry.label,
        link: `${link}#${entry.anchor}`,
        ...(entry.date && { date: entry.date }),
        description: teaser(
          [entry.description, body.trim()].filter(Boolean).join('\n\n'),
        ),
        categories: entry.tags,
      };
    }),
  );
  return {
    title: `${site.config.name} changelog`,
    link,
    description: page.description ?? `What changed in ${site.config.name}.`,
    items: sortNewestFirst(items),
  };
}

function postsChannel(
  site: Site,
  scope: { locale?: string; version?: string },
  siteUrl: string,
) {
  const view = site.view(scope);
  const items: FeedItem[] = view.tree.pages
    .filter(
      (p) => p.date && !p.hidden && !p.fallbackLocale && !site.isProtected(p),
    )
    .map((p) => ({
      title: p.title,
      link: canonicalUrl(siteUrl, p.path),
      date: p.date,
      ...(p.description && { description: p.description }),
      categories: p.tags ?? [],
    }));
  if (items.length === 0) return undefined;
  return {
    title: site.config.name,
    link: canonicalUrl(siteUrl, site.homeOf(scope)),
    description: site.config.seo.description ?? site.config.name,
    items: sortNewestFirst(items),
  };
}
