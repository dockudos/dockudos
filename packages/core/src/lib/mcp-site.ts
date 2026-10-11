import { join } from 'node:path';
import { expandAccessRules, findAccessRule } from './access.ts';
import type { DocsConfig } from './config.ts';
import { publicIndex, resolveScope, scopeFilter } from './index-filter.ts';
import { KeywordSearch } from './keyword-search.ts';
import { publicPages } from './llms.ts';
import type { MarkdownComponents } from './markdown-twin.ts';
import { type McpBackend, McpScopeError, createDocsBackend } from './mcp.ts';
import { buildNavigation } from './navigation.ts';
import type { PageTree } from './page-tree.ts';
import {
  buildSiteIndex,
  readIndexFile,
  readPageMarkdown,
} from './site-index.ts';
import { type Variant, versionInfos } from './variants.ts';

/**
 * The documentation of a project on disk, as an MCP backend, for use outside Next.js (`dockudos mcp`). Uses the
 * index `dockudos build` wrote when there is one, else builds it, and answers from memory afterwards. Protected
 * pages are neither searched nor readable: there is no one to show credentials. On a site with versions and
 * languages, searches and listings cover the defaults unless the caller names another.
 */
export async function createSiteBackend({
  root,
  docsDir = join(root, 'docs'),
  config,
  tree,
  views,
  components,
}: {
  root: string;
  docsDir?: string;
  config: DocsConfig;
  /** Every page, of every version and language. */
  tree: PageTree;
  /** The tree of each version and language. Without it the site is taken to have one. */
  views?: readonly { variant: Variant; tree: PageTree }[];
  /** The components of the site, so pages read as Markdown the way the site's own twins do. */
  components?: MarkdownComponents;
}): Promise<McpBackend> {
  // Rules written for the default version and language cover every one.
  const rules = expandAccessRules(config.access.rules, config);
  const closed = { ...config, access: { ...config.access, rules } };
  const full =
    (await readIndexFile(root)) ??
    (await buildSiteIndex({ root, docsDir, config, tree })).index;
  const engine = new KeywordSearch(publicIndex(full, closed));
  const versions = versionInfos(config);

  const listed = (views ?? [{ variant: {}, tree }]).flatMap((view) => {
    const own = versions.find(
      (v) => v.name === view.variant.version,
    )?.navigation;
    const nav = buildNavigation(
      { navigation: own ?? config.navigation },
      view.tree,
      {
        lenient: view !== (views ?? [])[0],
      },
    );
    return publicPages(closed, nav).map(({ page }) => ({
      path: page.path,
      title: page.title,
      ...(page.description && { description: page.description }),
      ...(page.version && { version: page.version }),
      ...(page.locale && { locale: page.locale }),
    }));
  });

  return createDocsBackend({
    search: (query, { limit, version, locale }) => {
      const { scope, error } = resolveScope(config, { version, locale });
      if (error || !scope)
        throw new McpScopeError(error ?? 'Unknown version or language.');
      return engine.search(query, {
        limit,
        maxPerPage: 2,
        filter: scopeFilter(scope),
      });
    },
    pages: tree.pages,
    listed,
    defaults: {
      version: config.versions?.default,
      locale: config.i18n?.default,
    },
    markdown: (path) => {
      const page = tree.pages.find((p) => p.path === path);
      return page ? readPageMarkdown(docsDir, page, { components }) : '';
    },
    isProtected: (path) => !!findAccessRule(rules, path),
  });
}
