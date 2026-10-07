import type { ChildProcess } from 'node:child_process';

/** Resolves with the child's exit code (or 1 if it was killed by a signal). */
export function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
