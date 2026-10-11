import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { CommandRunner } from './exec.ts';
import type { GitProvider } from './git/types.ts';

/** Put the repository's files at `sha` into `dest`. */
export type SourceFetcher = (input: { provider: GitProvider; repo: string; sha: string; dest: string; onOutput: (s: string) => void; signal?: AbortSignal }) => Promise<void>;

/** `git fetch --depth 1` of one commit. The token travels in environment variables, not in the command line or URL. */
export const gitSource = (run: CommandRunner): SourceFetcher => async ({ provider, repo, sha, dest, onOutput, signal }) => {
  const header = provider.cloneAuthHeader();
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  if (header) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: header });
  const git = async (...args: string[]) => {
    const { code } = await run({ cmd: 'git', args, cwd: dest, env, onOutput, timeoutMs: 300_000, ...(signal && { signal }) });
    if (code !== 0) throw new Error(`git ${args[0]} failed (exit ${code})`);
  };
  await mkdir(dest, { recursive: true });
  await git('init', '--quiet');
  await git('fetch', '--quiet', '--depth', '1', provider.cloneUrl(repo), sha);
  await git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
};

/** The same through the host's REST API: slower, but needs no `git` binary. For small repositories and tests. */
export const apiSource: SourceFetcher = async ({ provider, repo, sha, dest }) => {
  const root = resolve(dest);
  for (const path of await provider.listFiles(repo, sha)) {
    const file = await provider.readFile(repo, path, sha);
    if (!file) continue;
    const target = resolve(root, path);
    if (!target.startsWith(root + sep)) throw new Error(`Refusing path outside the checkout: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await mkdir(join(root), { recursive: true });
};
