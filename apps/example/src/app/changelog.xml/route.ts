import { createFeedHandler } from '@dockudos/next/feeds';

// An RSS feed of the <Update> entries on the changelog page. Needs `feeds.changelog` and `seo.siteUrl` in docs.json.
export const dynamic = 'force-static';
export const GET = createFeedHandler('changelog');
