import { createDocsApi } from '@dockudos/next/api';

// Everything dockudos serves from /api: search and its index, page text for tools, the Markdown of a page, and the
// assistant (/api/ask, /api/navigate). OPTIONS answers the preflight of sites listed in ai.allowedOrigins.
export const { GET, POST, OPTIONS } = createDocsApi();
