import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type DocsConfig, DocsConfigError, parseConfig } from './lib/config.ts';
import { type PageTree, buildPageTree } from './lib/page-tree.ts';

/** Read and validate `<root>/docs.json`. */
export async function loadConfig(root: string): Promise<DocsConfig> {
  const file = join(root, 'docs.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new DocsConfigError(['file not found'], file);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DocsConfigError(
      [`not valid JSON (${(e as Error).message})`],
      file,
    );
  }
  return parseConfig(json, file);
}

/** Walk `<docsDir>` and build its page tree. */
export async function discoverPages(docsDir: string): Promise<PageTree> {
  const entries = await readdir(docsDir, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(docsDir.length + 1));
  return buildPageTree(files);
}
