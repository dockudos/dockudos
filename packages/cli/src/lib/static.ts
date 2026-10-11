import { resolveRedirects } from '@dockudos/core';
import { readIndexFile, readPageMarkdown } from '@dockudos/core/node';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CliError, type Env } from './io.ts';
import { siteComponents } from './mcp.ts';
import type { Project } from './project.ts';

/** What needs a server. A static build sets these aside, because `output: 'export'` cannot build them. */
const SERVER_ONLY = [
  'src/app/api',
  'src/app/mcp',
  'src/app/embed',
  'src/proxy.ts',
  'src/middleware.ts',
  'app/api',
  'app/mcp',
  'app/embed',
  'proxy.ts',
  'middleware.ts',
];

const STASH = '.dockudos/static-stash';

/** Put back anything a previous static build set aside (also after a crash). */
export async function restoreServerFiles(root: string): Promise<void> {
  for (const path of SERVER_ONLY) {
    const stashed = join(root, STASH, path);
    if (!existsSync(stashed)) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await rename(stashed, join(root, path));
  }
  await rm(join(root, STASH), { recursive: true, force: true });
}

/** Move the server-only routes aside. Returns the paths moved. */
async function stashServerFiles(root: string): Promise<string[]> {
  await restoreServerFiles(root);
  const moved: string[] = [];
  for (const path of SERVER_ONLY) {
    const from = join(root, path);
    if (!existsSync(from)) continue;
    await mkdir(dirname(join(root, STASH, path)), { recursive: true });
    await rename(from, join(root, STASH, path));
    moved.push(path);
  }
  return moved;
}

/** A site with `access` rules would publish its protected pages to everyone as plain files. */
export function assertExportable(project: Project): void {
  const rules = project.config.access.rules;
  if (rules.length > 0)
    throw new CliError(
      `Cannot build a static site: docs.json has ${rules.length} \`access\` rule${rules.length === 1 ? '' : 's'}, and a static site has no server to enforce them. Every page would be public.\nRemove the rules, or build with \`dockudos build\` and host it on a server.`,
    );
}

/** The folder name with a leading slash and no trailing one, or '' for the root. */
export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/**
 * Run `build` with the server-only files set aside, then put them back, whatever happens.
 * Returns what `build` returned.
 */
export async function withoutServerFiles<T>(
  env: Env,
  build: () => Promise<T>,
): Promise<T> {
  const moved = await stashServerFiles(env.cwd);
  if (moved.length > 0)
    env.out(
      `Static build: leaving out ${moved.join(', ')} (they need a server).\n`,
    );
  try {
    return await build();
  } finally {
    await restoreServerFiles(env.cwd);
  }
}

/**
 * Files the pages expect next to them: the search index for the in-browser engine (`/api/search/index`),
 * a `.md` twin of every page for "Copy page", and a page for each `docs.json` redirect.
 */
export async function writeStaticAssets(
  env: Env,
  project: Project,
  out = join(env.cwd, 'out'),
): Promise<void> {
  const index = await readIndexFile(env.cwd);
  if (index) {
    const { embeddings: _embeddings, ...rest } = index;
    const file = join(out, 'api/search/index');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        ...rest,
        chunks: index.chunks.map(({ vector: _vector, ...chunk }) => chunk),
      }),
    );
  }

  const components = await siteComponents(env.cwd);
  for (const page of project.tree.pages) {
    const name = page.path === '/' ? '/index' : page.path;
    const file = join(out, `${name}.md`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      await readPageMarkdown(project.docsDir, page, { components }),
    );
  }

  const base = normalizeBasePath(env.vars.DOCKUDOS_BASE_PATH);
  const redirects = resolveRedirects(
    project.config.redirects,
    project.tree.pages.map((p) => p.path),
  );
  let skipped = 0;
  for (const { source, destination } of redirects) {
    if (/[:*(]/.test(source)) {
      skipped++;
      continue;
    }
    const target = /^[a-z]+:/i.test(destination)
      ? destination
      : base + destination;
    const file = join(out, source, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `<!doctype html><meta charset="utf-8"><title>Redirecting</title><link rel="canonical" href="${target}"><meta http-equiv="refresh" content="0; url=${target}"><a href="${target}">Redirecting to ${target}</a>\n`,
    );
  }
  if (skipped > 0)
    env.err(
      `${skipped} redirect${skipped === 1 ? '' : 's'} with patterns ${skipped === 1 ? 'was' : 'were'} not written: a static site cannot match patterns. Add them to your host's redirect rules.\n`,
    );
}
