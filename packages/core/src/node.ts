import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DocsConfig, DocsConfigError, parseConfig } from './lib/config.ts';
import {
  type Variant,
  allVariants,
  localeInfos,
  variantDir,
  variantKey,
  variantPrefix,
  versionInfos,
} from './lib/variants.ts';
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

import { createLocalSource } from './lib/sources-node.ts';
import type { SourceFile } from './lib/sources/types.ts';

function parseConfigText(text: string, file: string): DocsConfig {
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

/** Read and validate `<root>/docs.json`. */
export async function loadConfig(root: string): Promise<DocsConfig> {
  const file = join(root, 'docs.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new DocsConfigError(['file not found'], file);
  }
  return parseConfigText(text, file);
}

/** Synchronous `loadConfig`, for places that cannot await, such as `next.config`. */
export function loadConfigSync(root: string): DocsConfig {
  const file = join(root, 'docs.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new DocsConfigError(['file not found'], file);
  }
  return parseConfigText(text, file);
}

/** Read each page's frontmatter. Bad frontmatter in several files is reported together, in file order. */
function readSources(files: readonly SourceFile[]): Map<string, PageSource> {
  const errors: Error[] = [];
  const sources = files.map((f): PageSource => {
    const text = f.content as string;
    try {
      const { data, body } = parseFrontmatter(text, f.path);
      const {
        title,
        description,
        icon,
        hidden,
        sidebarTitle,
        layout,
        kudos,
        api,
        date,
        tags,
      } = data;
      return {
        file: f.path,
        title: title ?? firstHeading(body),
        description,
        icon,
        hidden,
        sidebarTitle,
        layout,
        kudos,
        api,
        date,
        tags,
      };
    } catch (e) {
      if (e instanceof FrontmatterError) errors.push(e);
      else throw e;
      return { file: f.path };
    }
  });
  if (errors.length) {
    throw new ContentError(
      errors.sort((a, b) =>
        (a as FrontmatterError).file < (b as FrontmatterError).file ? -1 : 1,
      ),
    );
  }
  return new Map(sources.map((s) => [s.file, s]));
}

async function listPages(docsDir: string): Promise<SourceFile[]> {
  try {
    return await createLocalSource(docsDir).read();
  } catch {
    throw new Error(`Docs folder not found: ${docsDir}`);
  }
}

/** Walk `<docsDir>`, read each page's frontmatter and build the page tree. */
export async function discoverPages(
  docsDir: string,
  options: { prefix?: string } = {},
): Promise<PageTree> {
  const sources = readSources(await listPages(docsDir));
  return buildPageTree([...sources.values()], options);
}

/** One version and language of the docs, with its own page tree. */
export interface ContentView {
  variant: Variant;
  /** `variantKey(variant)`. */
  key: string;
  /** Prefix of the view's addresses, after `urlPrefix`: `/v1/fr`, or '' for the default. */
  prefix: string;
  tree: PageTree;
}

export interface SiteContent {
  /** The default view's structure, with `pages` holding the pages of every view. */
  tree: PageTree;
  views: ContentView[];
}

/**
 * Discover the pages of a site with versions and languages. Files live in `docs/<version>/<language>/`; a language
 * missing a page is given the default language's page as a stand-in (`fallbackLocale`). A site with neither is
 * one view, as `discoverPages` gives.
 */
export async function discoverSite(
  docsDir: string,
  config: Pick<DocsConfig, 'versions' | 'i18n' | 'urlPrefix'>,
): Promise<SiteContent> {
  const urlPrefix = config.urlPrefix ?? '';
  const variants = allVariants(config);
  if (!config.versions && !config.i18n) {
    const tree = await discoverPages(docsDir, { prefix: urlPrefix });
    return { tree, views: [{ variant: {}, key: '', prefix: '', tree }] };
  }

  const sources = readSources(await listPages(docsDir));
  const files = [...sources.keys()];
  const inDir = (dir: string) =>
    files
      .filter((f) => f.startsWith(`${dir}/`))
      .map((f) => sources.get(f) as PageSource);

  const views: ContentView[] = [];
  for (const variant of variants) {
    const dir = variantDir(config, variant);
    const own = inDir(dir);
    let list = own;
    const fallback = config.i18n?.default;
    if (fallback && variant.locale !== fallback) {
      const base = variantDir(config, { ...variant, locale: fallback });
      const have = new Set(own.map((s) => s.file.slice(dir.length + 1)));
      list = [
        ...own,
        ...inDir(base)
          .filter((s) => !have.has(s.file.slice(base.length + 1)))
          .map((s) => ({
            ...s,
            fallbackLocale: fallback,
            contentFile: s.file.slice(base.length + 1),
          })),
      ];
    }
    const prefix = variantPrefix(config, variant);
    const tree = buildPageTree(list, {
      prefix: urlPrefix + prefix,
      dir,
      segments: prefix.split('/').filter(Boolean),
      locale: variant.locale,
      version: variant.version,
    });
    views.push({ variant, key: variantKey(variant), prefix, tree });
  }

  const main = views[0] as ContentView;
  if (main.tree.pages.length === 0)
    throw new Error(
      `No pages found in ${join(docsDir, variantDir(config, main.variant))}. With "versions" or "i18n" in docs.json, pages live in docs/<version>/<language>/ (for example docs/${variantDir(config, main.variant)}/index.mdx).`,
    );

  // A page named like a version or language would be unreachable behind that prefix.
  const reserved = new Set([
    ...versionInfos(config)
      .filter((v) => !v.isDefault)
      .map((v) => v.name),
    ...localeInfos(config)
      .filter((l) => !l.isDefault)
      .map((l) => l.code),
  ]);
  const clash = main.tree.pages.find(
    (p) => p.rel.split('/')[1] && reserved.has(p.rel.split('/')[1] as string),
  );
  if (clash)
    throw new Error(
      `The page ${clash.file} is at ${clash.rel}, but "${clash.rel.split('/')[1]}" is the name of a version or language and starts its addresses. Rename the folder.`,
    );

  return {
    tree: { ...main.tree, pages: views.flatMap((v) => v.tree.pages) },
    views,
  };
}

export * from './lib/last-modified.ts';
export * from './lib/check-links.ts';
export * from './lib/icon-packs.ts';
export * from './lib/site-index.ts';
export * from './lib/mcp-site.ts';
export * from './lib/api/bundle.ts';
export * from './lib/api/openapi.ts';
export {
  generateOpenApi,
  expandRoot,
  type GeneratedFile,
} from './lib/api/generate-openapi.ts';
export * from './lib/api/sources.ts';
export * from './lib/api/asyncapi.ts';
export * from './lib/api/graphql.ts';
export * from './lib/api/reference.ts';
export * from './lib/sources-node.ts';
