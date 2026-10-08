import { ApiSpecError } from '@dockudos/core';
import { generateApiDocs, loadConfig } from '@dockudos/core/node';
import { isAbsolute, resolve } from 'node:path';
import { CliError, type Env } from './io.ts';

/**
 * Write the pages and data for every API and code reference source in docs.json. Does nothing when there are none.
 * Throws a `CliError` that names the spec and the reason when one cannot be read.
 */
export async function generatePages(
  env: Env,
  { force = false, quiet = false }: { force?: boolean; quiet?: boolean } = {},
): Promise<number> {
  let config;
  try {
    config = await loadConfig(env.cwd);
  } catch (e) {
    // Reading docs.json is `loadProject`'s job, with its message; nothing to generate without it.
    throw new CliError((e as Error).message);
  }
  if (!config.openapi.sources.length && !config.reference.sources.length)
    return 0;
  try {
    const reports = await generateApiDocs({
      root: env.cwd,
      config,
      force,
      log: (line) => !quiet && env.out(`${line}\n`),
    });
    return reports.reduce((n, r) => n + r.pages, 0);
  } catch (e) {
    if (e instanceof ApiSpecError) throw new CliError(e.message);
    throw e;
  }
}

/** The local files that specs and code references are read from, to watch while developing. */
export async function watchedInputs(env: Env): Promise<string[]> {
  try {
    const config = await loadConfig(env.cwd);
    const files = [
      ...config.openapi.sources.map((s) => s.spec),
      ...config.reference.sources.flatMap((s) =>
        Array.isArray(s.input) ? s.input : [s.input],
      ),
    ];
    return files
      .filter((f) => !/^https?:\/\//i.test(f))
      .map((f) => (isAbsolute(f) ? f : resolve(env.cwd, f)));
  } catch {
    return [];
  }
}

/** `dockudos generate`: write API reference pages from the specs in docs.json (--force to ignore the cache). */
export async function generate(env: Env, args: string[]): Promise<number> {
  const force = args.includes('--force');
  const unknown = args.filter((a) => a !== '--force');
  if (unknown.length)
    throw new CliError(
      `Unknown option "${unknown[0]}". Usage: dockudos generate [--force]`,
    );
  const pages = await generatePages(env, { force });
  if (!pages)
    env.out(
      'Nothing to generate: add "openapi.sources" or "reference.sources" to docs.json.\n',
    );
  return 0;
}
