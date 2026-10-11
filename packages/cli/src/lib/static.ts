import {
  OG_SIZE,
  type Page,
  expandAccessRules,
  filterIndex,
  findAccessRule,
  ogElement,
  ogImagePath,
  publicIndex,
  resolveRedirects,
  versionInfos,
} from '@dockudos/core';
import { readIndexFile, readPageMarkdown } from '@dockudos/core/node';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Env } from './io.ts';
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

/**
 * A static site has no server to enforce `access` rules, so it simply does not contain the pages they cover: not as pages,
 * not as Markdown twins, not in the search index, the sitemap, `llms.txt` or as social cards. Returns what was left out.
 */
export function protectedPages(project: Project): string[] {
  const rules = expandAccessRules(project.config.access.rules, project.config);
  return project.tree.pages
    .filter((p) => findAccessRule(rules, p.path))
    .map((p) => p.path);
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
  const rules = expandAccessRules(project.config.access.rules, project.config);
  const index = await readIndexFile(env.cwd);
  if (index) {
    // The index file on disk holds protected pages too; a static site has no server to keep them back, so they never go out.
    const open = publicIndex(index, { access: { rules } });
    // One file per version and language, because a static host cannot read `?version=&locale=`. The browser asks for
    // `index-v1~fr` (see `searchIndexUrl`); a site with neither has the plain `index`.
    for (const view of project.views) {
      const scoped = filterIndex(
        open,
        (p) =>
          (view.variant.locale === undefined ||
            p.locale === view.variant.locale) &&
          (view.variant.version === undefined ||
            p.version === view.variant.version),
      );
      const { embeddings: _embeddings, ...rest } = scoped;
      const body = JSON.stringify({
        ...rest,
        chunks: scoped.chunks.map(({ vector: _vector, ...chunk }) => chunk),
      });
      const parts = [view.variant.version, view.variant.locale].filter(Boolean);
      const names = parts.length ? [`index-${parts.join('~')}`] : [];
      if (view === project.views[0]) names.push('index');
      for (const name of names) {
        const file = join(out, 'api/search', name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, body);
      }
    }
  }

  const components = await siteComponents(env.cwd);
  for (const page of project.tree.pages) {
    if (findAccessRule(rules, page.path)) continue;
    const name = page.path === '/' ? '/index' : page.path;
    const file = join(out, `${name}.md`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      await readPageMarkdown(project.docsDir, page, { components }),
    );
  }

  await writeOgImages(env, project, out, rules);

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

type ImageResponseClass = new (
  element: unknown,
  options: { width: number; height: number },
) => Response;

/** `ImageResponse` from the project's own Next.js, which is what draws the cards on a server. */
function loadImageResponse(cwd: string): ImageResponseClass | undefined {
  try {
    const og = createRequire(join(cwd, 'package.json'))('next/og') as {
      ImageResponse?: ImageResponseClass;
    };
    return og.ImageResponse;
  } catch {
    return undefined;
  }
}

/**
 * Draw the social card of every page into `og/`, the files `og:image` points at. Needs `seo.siteUrl` and Next's
 * image renderer; when either is missing the cards are skipped and the pages simply have none.
 */
export async function writeOgImages(
  env: Env,
  project: Project,
  out: string,
  rules = project.config.access.rules,
): Promise<number> {
  const { config } = project;
  if (!config.seo.siteUrl || !config.seo.ogImages) return 0;
  const ImageResponse = loadImageResponse(env.cwd);
  if (!ImageResponse) {
    env.err(
      'Social-card images skipped: the image renderer of Next.js could not be loaded.\n',
    );
    return 0;
  }
  const versions = versionInfos(config);
  const pages = project.tree.pages.filter(
    (p: Page) => !p.hidden && !findAccessRule(rules, p.path),
  );
  let written = 0;
  const queue = [...pages];
  // Drawing is heavy: a few at a time.
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let page = queue.shift(); page; page = queue.shift()) {
        const version = versions.find((v) => v.name === page.version);
        try {
          const image = new ImageResponse(
            ogElement({
              siteName: config.name,
              title: page.title,
              description: page.description,
              badge: version?.label,
              primary: config.theme.primary,
            }),
            OG_SIZE,
          );
          const file = join(out, ogImagePath(page.path));
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, new Uint8Array(await image.arrayBuffer()));
          written++;
        } catch (error) {
          env.err(
            `Social card for ${page.path} skipped: ${(error as Error).message}\n`,
          );
        }
      }
    }),
  );
  return written;
}
