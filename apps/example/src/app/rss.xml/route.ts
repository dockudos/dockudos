import { createFeedHandler } from '@dockudos/next/feeds';

// An RSS feed of the pages that have a `date` in their frontmatter. Needs `feeds.posts` and `seo.siteUrl` in docs.json.
export const dynamic = 'force-static';
export const GET = createFeedHandler('posts');
