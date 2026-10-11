import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnRunner } from './exec.ts';
import { createMemoryGit } from './git/memory.ts';
import type { GitProvider } from './git/types.ts';
import { apiSource, gitSource } from './sources.ts';

const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'dkd-src-'));
  dirs.push(d);
  return d;
};
afterAll(() =>
  Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))),
);

describe('gitSource (real git)', () => {
  it('fetches exactly one commit of a repository into a directory', async () => {
    const origin = await tmp();
    const git = (...a: string[]) =>
      execFileSync(
        'git',
        ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
        { encoding: 'utf8' },
      ).trim();
    git('init', '--quiet', '-b', 'main');
    await writeFile(join(origin, 'docs.json'), '{"name":"A"}');
    await mkdir(join(origin, 'docs'));
    await writeFile(join(origin, 'docs/index.mdx'), '# One');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'one');
    const first = git('rev-parse', 'HEAD');
    await writeFile(join(origin, 'docs/index.mdx'), '# Two');
    git('commit', '--quiet', '-am', 'two');
    git('config', 'uploadpack.allowReachableSHA1InWant', 'true');

    const provider = {
      cloneUrl: () => origin,
      cloneAuthHeader: () => undefined,
    } as unknown as GitProvider;
    const dest = join(await tmp(), 'checkout');
    let out = '';
    await gitSource(spawnRunner)({
      provider,
      repo: 'o/r',
      sha: first,
      dest,
      onOutput: (c) => (out += c),
    });
    expect(await readFile(join(dest, 'docs/index.mdx'), 'utf8')).toBe('# One');
    expect(out).toBeDefined();
  });

  it('fails clearly when git fails, and passes the token only through the environment', async () => {
    const seen: { args: string[]; env?: Record<string, string> | undefined }[] =
      [];
    const run = async (i: { args: string[]; env?: Record<string, string> }) => {
      seen.push({ args: i.args, env: i.env });
      return { code: i.args[0] === 'fetch' ? 128 : 0 };
    };
    const provider = {
      cloneUrl: () => 'https://example.test/o/r.git',
      cloneAuthHeader: () => 'Authorization: Basic c2VjcmV0',
    } as unknown as GitProvider;
    await expect(
      gitSource(run as never)({
        provider,
        repo: 'o/r',
        sha: 'a'.repeat(40),
        dest: await tmp(),
        onOutput: () => undefined,
      }),
    ).rejects.toThrow('git fetch failed (exit 128)');
    expect(seen.every((s) => !s.args.join(' ').includes('c2VjcmV0'))).toBe(
      true,
    );
    expect(seen[0]!.env).toMatchObject({
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: Basic c2VjcmV0',
      GIT_TERMINAL_PROMPT: '0',
    });
  });
});

describe('apiSource', () => {
  it('writes the files of a commit and refuses a path that would leave the checkout', async () => {
    const git = createMemoryGit();
    const sha = git.seed('o/r', { 'a/b.txt': 'hi' });
    const dest = await tmp();
    await apiSource({
      provider: git,
      repo: 'o/r',
      sha,
      dest,
      onOutput: () => undefined,
    });
    expect(await readFile(join(dest, 'a/b.txt'), 'utf8')).toBe('hi');
    const evil = {
      ...git,
      listFiles: async () => ['../../escape.txt'],
      readFile: async () => ({ content: new Uint8Array([1]), sha: 'x' }),
    } as unknown as GitProvider;
    await expect(
      apiSource({
        provider: evil,
        repo: 'o/r',
        sha,
        dest,
        onOutput: () => undefined,
      }),
    ).rejects.toThrow('outside the checkout');
  });
});
