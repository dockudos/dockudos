import { join } from 'node:path';
import { findAccessRule } from './access.ts';
import type { DocsConfig } from './config.ts';
import { KeywordSearch } from './keyword-search.ts';
import { publicPages } from './llms.ts';
import { type McpBackend, createDocsBackend } from './mcp.ts';
import { buildNavigation } from './navigation.ts';
import type { PageTree } from './page-tree.ts';
import {
  buildSiteIndex,
  readIndexFile,
  readPageMarkdown,
} from './site-index.ts';

/**
 * The documentation of a project on disk, as an MCP backend, for use outside Next.js (`dockudos mcp`). Uses the
 * index `dockudos build` wrote when there is one, else builds it, and answers from memory afterwards. Protected
 * pages are not readable: there is no one to show credentials.
 */
export async function createSiteBackend({
  root,
  docsDir = join(root, 'docs'),
  config,
  tree,
}: {
  root: string;
  docsDir?: string;
  config: DocsConfig;
  tree: PageTree;
}): Promise<McpBackend> {
  const index =
    (await readIndexFile(root)) ??
    (await buildSiteIndex({ root, docsDir, config, tree })).index;
  const engine = new KeywordSearch(index);
  const listed = publicPages(config, buildNavigation(config, tree)).map(
    ({ page }) => ({
      path: page.path,
      title: page.title,
      ...(page.description && { description: page.description }),
    }),
  );
  return createDocsBackend({
    search: (query, { limit }) =>
      engine.search(query, { limit, maxPerPage: 2 }),
    pages: tree.pages,
    listed,
    markdown: (path) => {
      const page = tree.pages.find((p) => p.path === path);
      return page ? readPageMarkdown(docsDir, page) : '';
    },
    isProtected: (path) => !!findAccessRule(config.access.rules, path),
  });
}
