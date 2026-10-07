import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { type DocsConfig, DocsConfigError, parseConfig } from './lib/config.ts';
import {
  ContentError,
  FrontmatterError,
  firstHeading,
  parseFrontmatter,
} from './lib/frontmatter.ts';
import {
  type PageSource,
  type PageTree,
  buildPageTree,
} from './lib/page-tree.ts';

const DOC_EXT = /\.mdx?$/;

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

/** Walk `<docsDir>`, read each page's frontmatter and build the page tree. */
export async function discoverPages(docsDir: string): Promise<PageTree> {
  let entries;
  try {
    entries = await readdir(docsDir, { recursive: true, withFileTypes: true });
  } catch {
    throw new Error(`Docs folder not found: ${docsDir}`);
  }
  const files = entries
    .filter((e) => e.isFile() && DOC_EXT.test(e.name))
    .map((e) =>
      relative(docsDir, join(e.parentPath, e.name)).replaceAll(sep, '/'),
    )
    .filter(
      (f) =>
        !f
          .split('/')
          .some((part) => part.startsWith('.') || part === 'node_modules'),
    );

  const errors: Error[] = [];
  const sources = await Promise.all(
    files.map(async (file): Promise<PageSource> => {
      const text = await readFile(join(docsDir, file), 'utf8');
      try {
        const { data, body } = parseFrontmatter(text, file);
        const { title, description, icon, hidden, sidebarTitle } = data;
        return {
          file,
          title: title ?? firstHeading(body),
          description,
          icon,
          hidden,
          sidebarTitle,
        };
      } catch (e) {
        if (e instanceof FrontmatterError) errors.push(e);
        else throw e;
        return { file };
      }
    }),
  );
  if (errors.length) throw new ContentError(errors);
  return buildPageTree(sources);
}
