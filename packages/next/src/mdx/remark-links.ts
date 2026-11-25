import { resolveDocLink } from '@dockudos/core';
import type { Root } from 'mdast';
import { relative } from 'node:path';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export interface RemarkLinksOptions {
  /** Absolute path of the docs folder; links resolve relative to the file's place inside it. */
  docsDir: string;
  /** Where the docs are mounted in the site (`urlPrefix`). */
  prefix?: string;
  /** Base path of a static export on a sub-path (`/docs`), put in front of every page link. */
  basePath?: string;
}

/** Rewrite links between pages (`./other.mdx#x`) to site paths (`/guides/other#x`). */
const remarkLinks: Plugin<[RemarkLinksOptions], Root> =
  ({ docsDir, prefix, basePath = '' }) =>
  (tree, file) => {
    if (!file.path) return;
    const from = relative(docsDir, file.path).replaceAll('\\', '/');
    if (from.startsWith('..')) return;

    visit(tree, 'link', (node) => {
      const link = resolveDocLink(from, node.url, { prefix });
      if (link.kind === 'internal') {
        const path = link.hash ? `${link.path}#${link.hash}` : link.path;
        node.url = `${basePath}${path}`;
      }
    });
  };

export default remarkLinks;
