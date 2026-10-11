import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { DocsConfig } from './config.ts';
import { convertHtmlFiles } from './sources/html.ts';
import { createNotionSource } from './sources/notion.ts';
import { convertVault } from './sources/obsidian.ts';
import { createRemoteSource } from './sources/remote.ts';
import { createSanitySource } from './sources/sanity.ts';
import {
  type ContentSource,
  type SourceFile,
  SourceError,
  assertSourceFiles,
  isPageFile,
  sortFiles,
} from './sources/types.ts';

export type { ContentSource, SourceFile } from './sources/types.ts';

async function walk(
  dir: string,
  skip: (part: string) => boolean,
): Promise<{ path: string; full: string }[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    throw new SourceError(`Folder not found: ${dir}`);
  }
  // Symbolic links are not followed: a link could point out of the folder.
  return entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = join(e.parentPath, e.name);
      return { path: relative(dir, full).replaceAll(sep, '/'), full };
    })
    .filter((f) => !f.path.split('/').some(skip))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

const skipHidden = (part: string) =>
  part.startsWith('.') || part === 'node_modules';
/** The docs folder also leaves out files and folders that start with `_` (includes, snippets). */
const skipDocs = (part: string) => skipHidden(part) || part.startsWith('_');

/** The docs folder as a source: its `.md` and `.mdx` files. */
export function createLocalSource(dir: string, name = 'docs'): ContentSource {
  return {
    name,
    async read() {
      const files = await walk(dir, skipDocs);
      return Promise.all(
        files
          .filter((f) => isPageFile(f.path))
          .map(async (f) => ({
            path: f.path,
            content: await readFile(f.full, 'utf8'),
          })),
      );
    },
  };
}

async function readAll(
  dir: string,
  keep: (path: string) => boolean,
): Promise<SourceFile[]> {
  const files = await walk(dir, skipHidden);
  return Promise.all(
    files
      .filter((f) => keep(f.path))
      .map(async (f) => ({
        path: f.path,
        content: /\.(md|html?)$/i.test(f.path)
          ? await readFile(f.full, 'utf8')
          : new Uint8Array(await readFile(f.full)),
      })),
  );
}

/** An Obsidian vault folder as a source. */
export function createVaultSource({
  name,
  dir,
}: {
  name: string;
  dir: string;
}): ContentSource {
  return {
    name,
    async read() {
      return convertVault(
        await readAll(dir, (p) =>
          /\.(md|png|jpe?g|gif|svg|webp|avif)$/i.test(p),
        ),
      );
    },
  };
}

/** A folder of `.html` files as a source. */
export function createHtmlSource({
  name,
  dir,
}: {
  name: string;
  dir: string;
}): ContentSource {
  return {
    name,
    async read() {
      return convertHtmlFiles(await readAll(dir, (p) => /\.html?$/i.test(p)));
    },
  };
}

export interface ConfiguredSource {
  source: ContentSource;
  /** The folder below `docs/` the files are written to. */
  into: string;
}

/**
 * The sources of `docs.json`, ready to read. Secrets come from the environment variables the config names, never
 * from the file.
 */
export function sourcesFromConfig(
  config: Pick<DocsConfig, 'sources'>,
  root: string,
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): ConfiguredSource[] {
  const secret = (name: string | undefined, source: string) => {
    if (!name) return undefined;
    const value = env[name];
    if (!value)
      throw new SourceError(
        `The source "${source}" needs the ${name} environment variable.`,
      );
    return value;
  };
  return config.sources.map((s): ConfiguredSource => {
    switch (s.type) {
      case 'remote':
        return {
          into: s.into,
          source: createRemoteSource({
            name: s.name,
            url: s.url,
            token: secret(s.tokenEnv, s.name),
            mdx: s.mdx,
            fetch: fetcher,
          }),
        };
      case 'obsidian':
        return {
          into: s.into,
          source: createVaultSource({
            name: s.name,
            dir: resolve(root, s.dir),
          }),
        };
      case 'html':
        return {
          into: s.into,
          source: createHtmlSource({ name: s.name, dir: resolve(root, s.dir) }),
        };
      case 'notion':
        return {
          into: s.into,
          source: createNotionSource({
            name: s.name,
            rootId: s.rootId,
            token: secret(s.tokenEnv, s.name) as string,
            fetch: fetcher,
          }),
        };
      case 'sanity':
        return {
          into: s.into,
          source: createSanitySource({
            name: s.name,
            projectId: s.projectId,
            dataset: s.dataset,
            query: s.query,
            token: secret(s.tokenEnv, s.name),
            fetch: fetcher,
          }),
        };
    }
  });
}

export interface SyncResult {
  name: string;
  written: number;
  unchanged: number;
  removed: number;
}

const MANIFEST_DIR = '.dockudos/sources';

/**
 * Read a source and write its files into `docs/<into>/`. Only files the source wrote last time are ever replaced or
 * removed (a manifest keeps the list), so pages written by hand in the same folder are safe, and a page that
 * disappeared from the source disappears from the docs. A file is only rewritten when its content changed.
 */
export async function syncSource(
  root: string,
  docsDir: string,
  { source, into }: ConfiguredSource,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const files = sortFiles(await source.read(signal));
  assertSourceFiles(files, source.name);
  const base = resolve(docsDir, into);
  const inside = (p: string) => {
    const full = resolve(base, p);
    if (full !== base && !full.startsWith(base + sep))
      throw new SourceError(
        `${source.name}: "${p}" would be written outside docs/${into}.`,
      );
    return full;
  };

  const manifestFile = join(root, MANIFEST_DIR, `${source.name}.json`);
  let previous: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      files?: unknown;
    };
    previous = Array.isArray(parsed.files)
      ? parsed.files.filter((f): f is string => typeof f === 'string')
      : [];
  } catch {
    /* first sync */
  }

  let written = 0;
  let unchanged = 0;
  for (const file of files) {
    const full = inside(file.path);
    const bytes =
      typeof file.content === 'string'
        ? Buffer.from(file.content, 'utf8')
        : Buffer.from(file.content);
    try {
      if (Buffer.compare(await readFile(full), bytes) === 0) {
        unchanged++;
        continue;
      }
    } catch {
      /* new file */
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    written++;
  }

  const now = new Set(files.map((f) => f.path));
  let removed = 0;
  for (const old of previous) {
    if (now.has(old)) continue;
    try {
      await rm(inside(old), { force: true });
      removed++;
    } catch {
      /* a path that is no longer safe is left alone */
    }
  }
  await mkdir(dirname(manifestFile), { recursive: true });
  await writeFile(
    manifestFile,
    JSON.stringify({ files: [...now] }, null, 2) + '\n',
  );
  return { name: source.name, written, unchanged, removed };
}
