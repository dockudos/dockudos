import { embedIndex, resolveAiProviders } from '@dockudos/core';
import {
  buildSiteIndex,
  readIndexFile,
  writeIndexFile,
} from '@dockudos/core/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from './io.ts';
import type { Project } from './project.ts';

/** Parse the lines of a `.env` file: `KEY=value`, `export KEY=value`, quotes, `#` comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
      line,
    );
    if (!m) continue;
    let value = m[2] as string;
    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      value.endsWith(quote) &&
      value.length > 1
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[m[1] as string] = value;
  }
  return out;
}

/**
 * The environment for build-time secrets: the real environment, plus the `DOCKUDOS_*` variables of the
 * project's `.env` files (Next.js reads these files for the server, but not for this command). Variables
 * already set win, then `.env.local`, then `.env`.
 */
export async function buildEnv(
  root: string,
  vars: Env['vars'],
): Promise<Record<string, string | undefined>> {
  const merged: Record<string, string | undefined> = { ...vars };
  for (const name of [
    '.env.production.local',
    '.env.local',
    '.env.production',
    '.env',
  ]) {
    let text: string;
    try {
      text = await readFile(join(root, name), 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseDotenv(text)))
      if (key.startsWith('DOCKUDOS_') && merged[key] === undefined)
        merged[key] = value;
  }
  return merged;
}

const n = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Build the search index into `.dockudos/index.json`, reusing pages that did not change. With
 * `ai.embeddings` configured and a key available, it also computes vectors, reusing every vector whose text
 * and model are unchanged. Embedding trouble never fails the build: the site falls back to keyword search,
 * and the reason is printed.
 */
export async function indexSite(env: Env, project: Project): Promise<void> {
  const previous = await readIndexFile(env.cwd);
  const built = await buildSiteIndex({
    root: env.cwd,
    docsDir: project.docsDir,
    config: project.config,
    tree: project.tree,
    previous,
  });
  let { index } = built;
  env.out(
    `Indexed ${n(index.pages.length, 'page')} into ${n(index.chunks.length, 'chunk')} (${built.reusedPages} reused).\n`,
  );

  const { ai } = project.config;
  if (ai.enabled && ai.embeddings) {
    const resolved = resolveAiProviders(ai, {
      env: await buildEnv(env.cwd, env.vars),
    });
    if (!resolved.embeddings) {
      for (const problem of resolved.problems.filter((p) =>
        /embeddings/i.test(p),
      ))
        env.err(`Embeddings skipped. ${problem}\n`);
    } else {
      try {
        const embedded = await embedIndex(index, resolved.embeddings, {
          previous,
        });
        index = embedded.index;
        env.out(
          `Embedded ${n(embedded.embedded, 'chunk')} (${embedded.reused} reused).\n`,
        );
      } catch (error) {
        env.err(
          `Embeddings skipped. ${(error as Error).message} Search will use keywords until the next build.\n`,
        );
      }
    }
  }
  await writeIndexFile(env.cwd, index);
}
