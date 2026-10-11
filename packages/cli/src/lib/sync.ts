import {
  type SyncResult,
  loadConfig,
  sourcesFromConfig,
  syncSource,
} from '@dockudos/core/node';
import { SourceError } from '@dockudos/core';
import { join } from 'node:path';
import { buildEnv } from './index-site.ts';
import { CliError, type Env } from './io.ts';

/**
 * Read the `sources` of docs.json and write their pages into the docs folder. Returns what each did. `only` limits it to
 * the sources of those names.
 */
export async function syncSources(
  env: Env,
  {
    only = [],
    quiet = false,
  }: { only?: readonly string[]; quiet?: boolean } = {},
): Promise<SyncResult[]> {
  let config;
  try {
    config = await loadConfig(env.cwd);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const unknown = only.filter((n) => !config.sources.some((s) => s.name === n));
  if (unknown.length)
    throw new CliError(
      `No source named "${unknown[0]}" in docs.json. Sources: ${config.sources.map((s) => s.name).join(', ') || 'none'}.`,
    );
  const wanted = {
    ...config,
    sources: config.sources.filter(
      (s) => only.length === 0 || only.includes(s.name),
    ),
  };
  if (wanted.sources.length === 0) return [];

  const results: SyncResult[] = [];
  try {
    const configured = sourcesFromConfig(
      wanted,
      env.cwd,
      await buildEnv(env.cwd, env.vars),
    );
    for (const source of configured) {
      const result = await syncSource(env.cwd, join(env.cwd, 'docs'), source);
      results.push(result);
      if (!quiet)
        env.out(
          `${result.name}: ${result.written} written, ${result.unchanged} unchanged, ${result.removed} removed.\n`,
        );
    }
  } catch (e) {
    if (e instanceof SourceError) throw new CliError(e.message);
    throw e;
  }
  return results;
}

/** `dockudos sync [name...]`: fetch or convert the content sources of docs.json into the docs folder. */
export async function sync(env: Env, args: string[]): Promise<number> {
  const flag = args.find((a) => a.startsWith('-'));
  if (flag)
    throw new CliError(
      `Unknown option "${flag}". Usage: dockudos sync [name...]`,
    );
  const results = await syncSources(env, { only: args });
  if (results.length === 0)
    env.out(
      'Nothing to sync: add "sources" to docs.json (remote, obsidian, html, notion or sanity).\n',
    );
  return 0;
}
