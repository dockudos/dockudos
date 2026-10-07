import { resolveDocLink } from '@dockudos/core';
import type { Root } from 'mdast';
import { relative } from 'node:path';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export interface RemarkLinksOptions {
  /** Absolute path of the docs folder; links resolve relative to the file's place inside it. */
  docsDir: string;
}

/** Rewrite links between pages (`./other.mdx#x`) to site paths (`/guides/other#x`). */
const remarkLinks: Plugin<[RemarkLinksOptions], Root> =
  ({ docsDir }) =>
  (tree, file) => {
    if (!file.path) return;
    const from = relative(docsDir, file.path).replaceAll('\\', '/');
    if (from.startsWith('..')) return;

    visit(tree, 'link', (node) => {
      const link = resolveDocLink(from, node.url);
      if (link.kind === 'internal') {
        node.url = link.hash ? `${link.path}#${link.hash}` : link.path;
      }
    });
  };

export default remarkLinks;
