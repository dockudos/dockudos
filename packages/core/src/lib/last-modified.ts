import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface LastModified {
  date: Date;
  source: 'git' | 'fs';
}

/**
 * When a file last changed: the date of its last Git commit, or the file
 * system modification time when Git is unavailable, the file is not in a
 * repository, is untracked, or has uncommitted edits.
 */
export async function lastModified(file: string): Promise<LastModified> {
  const cwd = dirname(file);
  const name = basename(file);
  try {
    const dirty = await run('git', ['status', '--porcelain', '--', name], {
      cwd,
    });
    if (!dirty.stdout.trim()) {
      const log = await run('git', ['log', '-1', '--format=%cI', '--', name], {
        cwd,
      });
      const iso = log.stdout.trim();
      if (iso) return { date: new Date(iso), source: 'git' };
    }
  } catch {
    // git missing or not a repository: fall through
  }
  return { date: (await stat(file)).mtime, source: 'fs' };
}
