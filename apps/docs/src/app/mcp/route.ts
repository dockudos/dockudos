import { createMcpHandler } from '@dockudos/next/mcp';

// The docs for AI coding tools, over the Model Context Protocol: search_docs, get_page, list_pages.
export const { POST, GET, DELETE } = createMcpHandler();
