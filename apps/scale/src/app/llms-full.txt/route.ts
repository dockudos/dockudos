import { createLlmsFullHandler } from '@dockudos/next/llms';

// The whole documentation in one file, built when the site is built.
export const dynamic = 'force-static';
export const GET = createLlmsFullHandler();
