import {
  type DocsConfig,
  type Navigation,
  type PageTree,
  buildNavigation,
  resolveRedirects,
} from '@dockudos/core';
import {
  checkLinks,
  discoverPages,
  formatLinkProblems,
  loadConfig,
} from '@dockudos/core/node';
import { join } from 'node:path';
import { CliError } from './io.ts';

export interface Project {
  config: DocsConfig;
  tree: PageTree;
  nav: Navigation;
  docsDir: string;
}

/**
 * Load `docs.json` and the docs folder and check them against each other:
 * schema, frontmatter, navigation entries and redirects. Throws a `CliError`
 * whose message names the file, key and problem.
 */
export async function loadProject(root: string): Promise<Project> {
  const docsDir = join(root, 'docs');
  try {
    const config = await loadConfig(root);
    const tree = await discoverPages(docsDir);
    const nav = buildNavigation(config, tree);
    resolveRedirects(
      config.redirects,
      tree.pages.map((p) => p.path),
    );
    return { config, tree, nav, docsDir };
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

/** Internal links, anchors and assets. Returns the error text, or `undefined` when everything resolves. */
export async function findBrokenLinks(
  root: string,
  project: Project,
  { external = false }: { external?: boolean } = {},
): Promise<{ errors: number; warnings: number; report: string }> {
  const problems = await checkLinks({
    docsDir: project.docsDir,
    publicDir: join(root, 'public'),
    tree: project.tree,
    redirectSources: project.config.redirects.map((r) => r.source),
    external,
  });
  return {
    errors: problems.filter((p) => p.severity === 'error').length,
    warnings: problems.filter((p) => p.severity === 'warning').length,
    report: formatLinkProblems(problems),
  };
}
