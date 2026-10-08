import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocsConfig } from './config.ts';
import {
  type BuildIndexResult,
  type ContentIndex,
  type IndexInput,
  buildContentIndex,
  isContentIndex,
  isIndexable,
} from './content-index.ts';
import { expandIncludes } from './include.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { type MarkdownOptions, mdxToMarkdown } from './mdx-to-markdown.ts';
import type { Page, PageTree } from './page-tree.ts';
import { resolveVisibility } from './visibility.ts';

/** Where `dockudos build` writes the index, relative to the project root. Also the incremental-build cache. */
export const INDEX_FILE = '.dockudos/index.json';

/**
 * The Markdown body of a page as the rendered site shows it to people: `<include>`s expanded,
 * `<Visibility>` resolved for humans, frontmatter removed. Heading ids in it match the page's anchors.
 */
export async function readPageBody(
  docsDir: string,
  page: Pick<Page, 'file'>,
  audience: 'humans' | 'agents' = 'humans',
): Promise<string> {
  const readDoc = (file: string) => readFile(join(docsDir, file), 'utf8');
  const expanded = await expandIncludes(await readDoc(page.file), {
    file: page.file,
    read: readDoc,
  });
  return parseFrontmatter(resolveVisibility(expanded, audience), page.file)
    .body;
}

/**
 * A page as plain Markdown: title and description, then the content with `<include>`s expanded and frontmatter
 * removed, `<Visibility for="agents">` blocks kept and `for="humans"` blocks dropped, and components written as plain
 * Markdown (callouts as quotes, tabs and steps as headed lines; see `mdxToMarkdown`). For "copy page", `llms.txt`,
 * Markdown twins and AI tools.
 */
export async function readPageMarkdown(
  docsDir: string,
  page: Pick<Page, 'file' | 'title' | 'description'>,
  options?: MarkdownOptions,
): Promise<string> {
  const body = await readPageBody(docsDir, page, 'agents');
  const head = [`# ${page.title}`, page.description && `> ${page.description}`]
    .filter(Boolean)
    .join('\n\n');
  return `${head}\n\n${await mdxToMarkdown(body, options)}\n`;
}

export interface SiteIndexOptions {
  /** Project root, where `docs.json` lives. */
  root: string;
  /** Absolute folder with the MDX files. Default `<root>/docs`. */
  docsDir?: string;
  config: Pick<DocsConfig, 'access'>;
  tree: PageTree;
}

/** Read every public page (not hidden, not behind an access rule) into index inputs. */
export async function collectIndexInputs({
  root,
  docsDir = join(root, 'docs'),
  config,
  tree,
}: SiteIndexOptions): Promise<IndexInput[]> {
  const pages = tree.pages.filter((p) => isIndexable(p, config));
  return Promise.all(
    pages.map(async (page) => ({
      path: page.path,
      title: page.title,
      ...(page.description && { description: page.description }),
      body: await readPageBody(docsDir, page),
    })),
  );
}

/** Read the index written by `dockudos build`. `undefined` when there is none or it is from another version. */
export async function readIndexFile(
  root: string,
): Promise<ContentIndex | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, INDEX_FILE), 'utf8'),
    );
    return isContentIndex(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Write the index next to the build output. Atomic, so a reader never sees half a file. */
export async function writeIndexFile(
  root: string,
  index: ContentIndex,
): Promise<string> {
  const file = join(root, INDEX_FILE);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(index));
  await rename(temp, file);
  return file;
}

/**
 * Build the index of a site from its files, reusing what is unchanged since the index file written by
 * the last build. Does not write; see `writeIndexFile`.
 */
export async function buildSiteIndex(
  options: SiteIndexOptions & { previous?: ContentIndex; maxChars?: number },
): Promise<BuildIndexResult> {
  const previous = options.previous ?? (await readIndexFile(options.root));
  return buildContentIndex(await collectIndexInputs(options), {
    previous,
    maxChars: options.maxChars,
  });
}
