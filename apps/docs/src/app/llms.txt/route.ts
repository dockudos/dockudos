import { createLlmsHandler } from '@dockudos/next/llms';

// An index of the docs for AI tools, built when the site is built.
export const dynamic = 'force-static';
export const GET = createLlmsHandler();
