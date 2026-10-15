import { describe, expect, it } from 'vitest';
import { createGitHub } from './github.ts';
import { createGitLab } from './gitlab.ts';
import { createMemoryGit } from './memory.ts';
import { GitError } from './types.ts';

/** Records every request and answers `{}`; the real hosts answer these calls with a JSON body we do not read. */
function recorder() {
  const calls: { method: string; url: URL; body: any }[] = [];
  const fetcher = async (input: string | URL, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response('{}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetcher, calls };
}

describe('GitHub commit status', () => {
  it('posts the state under the dockudos/build context, trimming the description to 140 characters', async () => {
    const h = recorder();
    const gh = createGitHub({ token: 'tok123456', fetch: h.fetcher });
    await gh.reportStatus!({
      repo: 'o/r',
      sha: 'abc123',
      state: 'success',
      description: 'd'.repeat(300),
      url: 'https://acme.sites.test',
    });
    const [call] = h.calls;
    expect(call!.method).toBe('POST');
    expect(call!.url.pathname).toBe('/repos/o/r/statuses/abc123');
    expect(call!.body).toEqual({
      state: 'success',
      description: 'd'.repeat(140),
      context: 'dockudos/build',
      target_url: 'https://acme.sites.test',
    });
  });

  it('omits the link when there is none, and encodes the sha', async () => {
    const h = recorder();
    const gh = createGitHub({ fetch: h.fetcher });
    await gh.reportStatus!({
      repo: 'o/r',
      sha: 'a/b c',
      state: 'pending',
      description: 'Building',
    });
    expect(h.calls[0]!.url.pathname).toBe('/repos/o/r/statuses/a%2Fb%20c');
    expect('target_url' in h.calls[0]!.body).toBe(false);
  });

  it('refuses a repository name that is not owner/name before any request', async () => {
    const h = recorder();
    const gh = createGitHub({ fetch: h.fetcher });
    await expect(
      gh.reportStatus!({
        repo: '../x',
        sha: 'a',
        state: 'failure',
        description: 'x',
      }),
    ).rejects.toBeInstanceOf(GitError);
    expect(h.calls).toHaveLength(0);
  });
});

describe('GitLab commit status', () => {
  it.each([
    ['pending', 'running'],
    ['success', 'success'],
    ['failure', 'failed'],
  ] as const)('maps %s to %s', async (state, mapped) => {
    const h = recorder();
    const gl = createGitLab({ token: 'glpat-xxxxxx', fetch: h.fetcher });
    await gl.reportStatus!({
      repo: 'g/p',
      sha: 'abc',
      state,
      description: 'x'.repeat(200),
      url: 'https://docs.example',
    });
    const { url, method } = h.calls[0]!;
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/api/v4/projects/g%2Fp/statuses/abc');
    expect(url.searchParams.get('state')).toBe(mapped);
    expect(url.searchParams.get('name')).toBe('dockudos/build');
    expect(url.searchParams.get('description')).toBe('x'.repeat(140));
    expect(url.searchParams.get('target_url')).toBe('https://docs.example');
  });

  it('leaves the link out when there is none', async () => {
    const h = recorder();
    const gl = createGitLab({ fetch: h.fetcher });
    await gl.reportStatus!({
      repo: 'g/p',
      sha: 's',
      state: 'success',
      description: 'ok',
    });
    expect(h.calls[0]!.url.searchParams.has('target_url')).toBe(false);
  });
});

describe('memory git failure modes', () => {
  it('reports unknown repositories, branches and commits as 404/422 like a host would', async () => {
    const git = createMemoryGit();
    await expect(git.getDefaultBranch('no/repo')).rejects.toMatchObject({
      status: 404,
    });
    const head = git.seed('o/r', { 'a.txt': '1' });
    await expect(git.getBranchSha('o/r', 'nope')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      git.createBranch('o/r', 'b', 'unknown-sha'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      git.commit({ repo: 'o/r', branch: 'nope', message: 'm', changes: [] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(git.readFile('o/r', 'a.txt', 'no-ref')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      git.openPullRequest({
        repo: 'o/r',
        head: 'nope',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await git.readFile('o/r', 'missing.txt', head)).toBeUndefined();
    expect(await git.listFiles('o/r', head, 'sub')).toEqual([]);
  });

  it('records statuses, and the gitlab flavour identifies itself', async () => {
    const git = createMemoryGit('gitlab');
    expect(git.id).toBe('gitlab');
    await git.reportStatus!({
      repo: 'o/r',
      sha: 's',
      state: 'success',
      description: 'd',
    });
    expect(git.statuses).toEqual([{ repo: 'o/r', sha: 's', state: 'success' }]);
  });
});
