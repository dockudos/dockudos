import { createDocsApi } from '@dockudos/next/api';

// Search, the search index and page text for tools: /api/search, /api/search/index, /api/page.
export const { GET, POST } = createDocsApi();
