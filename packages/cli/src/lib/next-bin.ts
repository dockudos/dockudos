import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CliError } from './io.ts';

/** Absolute path of the project's own `next` binary, so the CLI never runs a different version. */
export function resolveNext(cwd: string): string {
  try {
    return createRequire(join(cwd, 'package.json')).resolve(
      'next/dist/bin/next',
    );
  } catch {
    throw new CliError(
      "Could not find `next` in this project. Run your package manager's install first, or run this from the project folder.",
    );
  }
}
