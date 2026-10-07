import { sitemapResponse } from '@dockudos/next/server';

export const dynamic = 'force-static';
export const GET = () => sitemapResponse();
