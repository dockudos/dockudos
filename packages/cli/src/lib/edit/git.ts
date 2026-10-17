import { execFile } from 'node:child_process';

export class GitFailure extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GitFailure';
    this.status = status;
  }
}

/** The paths the editor looks at; changes anywhere else in the repository are not its business. */
export const SCOPE = ['docs.json', 'docs', 'public/media'];

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export interface Change {
  path: string;
  status: ChangeStatus;
  /** Whether the change is already staged. */
  staged: boolean;
  from?: string;
}
export interface CommitInfo {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

function git(
  cwd: string,
  args: string[],
  input?: string,
  okCodes: number[] = [],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (error && typeof code === 'number' && okCodes.includes(code))
          resolve({ stdout, stderr });
        else if (error) {
          reject(
            new GitFailure(
              code === 'ENOENT'
                ? 'git is not installed or not on PATH.'
                : stderr.trim() || error.message,
            ),
          );
        } else resolve({ stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

function toStatus(x: string, y: string): ChangeStatus {
  const c = y !== ' ' && y !== '?' ? y : x;
  if (c === 'D') return 'deleted';
  if (c === 'R') return 'renamed';
  if (c === 'A' || c === '?') return 'added';
  return 'modified';
}

/** Parse `git status --porcelain=v1 -z`. */
export function parseStatus(raw: string): Change[] {
  const parts = raw.split('\0');
  const out: Change[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const change: Change = {
      path: entry.slice(3),
      status: toStatus(x, y),
      staged: x !== ' ' && x !== '?',
    };
    if (x === 'R' || x === 'C') change.from = parts[++i]!;
    out.push(change);
  }
  return out;
}

/** Git for one folder. Every call is an argument list, never a shell string. */
export function createGit(cwd: string) {
  return {
    /** The repository root when `cwd` is inside one, else `undefined`. */
    async root(): Promise<string | undefined> {
      try {
        return (await git(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim();
      } catch (e) {
        if (/not installed/.test((e as Error).message)) throw e;
        return undefined;
      }
    },
    async init(): Promise<void> {
      await git(cwd, ['init', '-q']);
    },
    async branch(): Promise<string> {
      const b = (
        await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ({
          stdout: '',
        }))
      ).stdout.trim();
      // A repository without commits has no HEAD; its branch is still named.
      if (b && b !== 'HEAD') return b;
      return (
        await git(cwd, ['symbolic-ref', '--short', 'HEAD']).catch(() => ({
          stdout: 'HEAD',
        }))
      ).stdout.trim();
    },
    async head(): Promise<string | undefined> {
      try {
        return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
      } catch {
        return undefined;
      }
    },
    /** Who commits will be attributed to, or `undefined` when Git has no identity configured. */
    async identity(): Promise<{ name: string; email: string } | undefined> {
      const get = (k: string) =>
        git(cwd, ['config', '--get', k]).then(
          (r) => r.stdout.trim(),
          () => '',
        );
      const [name, email] = await Promise.all([
        get('user.name'),
        get('user.email'),
      ]);
      return name && email ? { name, email } : undefined;
    },
    async status(): Promise<Change[]> {
      const [r, prefix] = await Promise.all([
        git(cwd, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          ...SCOPE,
        ]),
        git(cwd, ['rev-parse', '--show-prefix']).then((p) => p.stdout.trim()),
      ]);
      // Porcelain paths are relative to the repository root; the editor's are relative to its folder.
      const rel = (p: string) =>
        prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
      return parseStatus(r.stdout).map((c) => ({
        ...c,
        path: rel(c.path),
        ...(c.from !== undefined && { from: rel(c.from) }),
      }));
    },
    /** Unified diff of a path against HEAD. New files are shown whole. */
    async diff(path: string): Promise<string> {
      const tracked = await git(cwd, ['ls-files', '--', path]);
      if (!tracked.stdout.trim()) {
        // Untracked: `--no-index` exits 1 when the files differ, which is the normal case here.
        return (
          await git(
            cwd,
            ['diff', '--no-index', '--', '/dev/null', path],
            undefined,
            [1],
          )
        ).stdout;
      }
      const hasHead = await this.head();
      const args = hasHead
        ? ['diff', 'HEAD', '--', path]
        : ['diff', '--cached', '--', path];
      return (await git(cwd, args)).stdout;
    },
    /** One commit with exactly `paths`; other staged work is left staged. Returns the new sha. */
    async commit(message: string, paths: string[]): Promise<string> {
      if (!message.trim())
        throw new GitFailure('A commit message is required.', 400);
      if (paths.length === 0)
        throw new GitFailure('Nothing selected to commit.', 400);
      // A path that is already staged as removed matches nothing for `add`; the commit below still takes it.
      for (const path of paths)
        await git(cwd, ['add', '-A', '--', path]).catch((e: GitFailure) => {
          if (!/did not match any files/.test(e.message)) throw e;
        });
      await git(cwd, ['commit', '-q', '-m', message, '--only', '--', ...paths]);
      return (await this.head())!;
    },
    async log(limit: number, path?: string): Promise<CommitInfo[]> {
      const args = [
        'log',
        `-n${Math.max(1, Math.min(limit, 200))}`,
        '--format=%H%x1f%s%x1f%an%x1f%aI%x1e',
        ...(path ? ['--', path] : []),
      ];
      const r = await git(cwd, args).catch(() => ({ stdout: '' }));
      return r.stdout
        .split('\x1e')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [sha, subject, author, date] = l.split('\x1f');
          return {
            sha: sha!,
            subject: subject ?? '',
            author: author ?? '',
            date: date ?? '',
          };
        });
    },
    /** Throw away uncommitted changes to `paths` (restore tracked files, delete untracked ones). */
    async discard(paths: string[]): Promise<void> {
      for (const path of paths) {
        const tracked = (
          await git(cwd, ['ls-files', '--', path])
        ).stdout.trim();
        if (tracked) {
          if (await this.head())
            await git(cwd, [
              'restore',
              '--staged',
              '--worktree',
              '--source=HEAD',
              '--',
              path,
            ]);
          else await git(cwd, ['rm', '-q', '-f', '--cached', '--', path]);
        } else await git(cwd, ['clean', '-q', '-f', '--', path]);
      }
    },
  };
}

export type Git = ReturnType<typeof createGit>;
