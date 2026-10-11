import { describe, expect, it } from 'vitest';
import { createGitHub } from './github.ts';
import { createGitLab } from './gitlab.ts';
import { createMemoryGit } from './memory.ts';
import {
  assertRepo,
  assertRepoPath,
  GitConflictError,
  GitError,
} from './types.ts';

type Route = (
  url: URL,
  init: RequestInit,
  body: any,
) => Response | object | undefined;
function mockHost(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: any; headers: Headers }[] =
    [];
  const fetcher = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      body,
      headers: new Headers(init.headers),
    });
    const handler = routes[`${method} ${url.pathname}`];
    const out = handler?.(url, init, body);
    if (out instanceof Response) return out;
    if (out === undefined)
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
      });
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetcher, calls };
}
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('validation', () => {
  it.each(['', 'noslash', '../x/y', 'a/../b', 'a b/c', 'a/b?x=1'])(
    'rejects repo %j',
    (r) => expect(() => assertRepo(r)).toThrow(GitError),
  );
  it.each(['owner/name', 'group/sub/name', 'a.b/c-d_e'])(
    'accepts repo %s',
    (r) => expect(() => assertRepo(r)).not.toThrow(),
  );
  it.each(['', '/etc', '../x', 'a/../b', 'a\\b', 'a//b'])(
    'rejects path %j',
    (p) => expect(() => assertRepoPath(p)).toThrow(GitError),
  );
});

describe('github', () => {
  const routes = {
    'GET /repos/o/r': () => ({ default_branch: 'main' }),
    'GET /repos/o/r/git/ref/heads/main': () => ({ object: { sha: 'head1' } }),
    'GET /repos/o/r/contents/docs/a.mdx': () => ({
      type: 'file',
      content: b64('# A'),
      sha: 'blob1',
    }),
    'GET /repos/o/r/contents/docs': () => ({ type: 'dir' }),
    'GET /repos/o/r/git/trees/main': () => ({
      tree: [
        { path: 'docs/a.mdx', type: 'blob' },
        { path: 'docs', type: 'tree' },
        { path: 'src/x.ts', type: 'blob' },
      ],
    }),
    'POST /repos/o/r/git/refs': () => ({}),
    'GET /repos/o/r/git/commits/head1': () => ({ tree: { sha: 'tree1' } }),
    'POST /repos/o/r/git/blobs': () => ({ sha: 'newblob' }),
    'POST /repos/o/r/git/trees': () => ({ sha: 'newtree' }),
    'POST /repos/o/r/git/commits': () => ({ sha: 'newcommit' }),
    'PATCH /repos/o/r/git/refs/heads/main': () => ({}),
    'POST /repos/o/r/pulls': () => ({
      html_url: 'https://github.com/o/r/pull/7',
      number: 7,
    }),
    'GET /repos/o/r/compare/a...b': () => ({
      files: [
        { filename: 'x', status: 'added', patch: '+1' },
        { filename: 'y', status: 'removed' },
        { filename: 'z', status: 'renamed' },
        { filename: 'w', status: 'changed' },
      ],
    }),
  };

  it('reads repository metadata, files and trees', async () => {
    const h = mockHost(routes);
    const gh = createGitHub({ token: 'tok123456', fetch: h.fetcher });
    expect(await gh.getDefaultBranch('o/r')).toBe('main');
    expect(await gh.getBranchSha('o/r', 'main')).toBe('head1');
    const f = await gh.readFile('o/r', 'docs/a.mdx', 'main');
    expect(new TextDecoder().decode(f!.content)).toBe('# A');
    expect(f!.sha).toBe('blob1');
    expect(await gh.readFile('o/r', 'docs', 'main')).toBeUndefined();
    expect(await gh.readFile('o/r', 'missing.md', 'main')).toBeUndefined();
    expect(await gh.listFiles('o/r', 'main', 'docs')).toEqual(['docs/a.mdx']);
    expect(h.calls[0]!.headers.get('authorization')).toBe('Bearer tok123456');
  });

  it('commits through blobs, tree, commit, fast-forward ref update', async () => {
    const h = mockHost(routes);
    const gh = createGitHub({ fetch: h.fetcher });
    const sha = await gh.commit({
      repo: 'o/r',
      branch: 'main',
      message: 'm',
      changes: [
        { path: 'a.md', content: 'hi' },
        { path: 'old.md', delete: true },
      ],
      expectedHeadSha: 'head1',
    });
    expect(sha).toBe('newcommit');
    const tree = h.calls.find(
      (c) => c.path.endsWith('/git/trees') && c.method === 'POST',
    )!.body;
    expect(tree.base_tree).toBe('tree1');
    expect(tree.tree).toEqual([
      { path: 'a.md', mode: '100644', type: 'blob', sha: 'newblob' },
      { path: 'old.md', mode: '100644', type: 'blob', sha: null },
    ]);
    expect(h.calls.at(-1)!.body).toEqual({ sha: 'newcommit', force: false });
  });

  it('turns a moved branch into a conflict, before and during the update', async () => {
    const gh = createGitHub({ fetch: mockHost(routes).fetcher });
    await expect(
      gh.commit({
        repo: 'o/r',
        branch: 'main',
        message: 'm',
        changes: [],
        expectedHeadSha: 'stale',
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
    const raced = createGitHub({
      fetch: mockHost({
        ...routes,
        'PATCH /repos/o/r/git/refs/heads/main': () =>
          new Response('{"message":"not a fast forward"}', { status: 422 }),
      }).fetcher,
    });
    await expect(
      raced.commit({
        repo: 'o/r',
        branch: 'main',
        message: 'm',
        changes: [{ path: 'a', content: 'b' }],
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
  });

  it('opens pull requests, creates branches and compares', async () => {
    const gh = createGitHub({ fetch: mockHost(routes).fetcher });
    expect(
      await gh.openPullRequest({
        repo: 'o/r',
        head: 'h',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).toEqual({ url: 'https://github.com/o/r/pull/7', number: 7 });
    await gh.createBranch('o/r', 'dockudos/x', 'head1');
    expect((await gh.compare('o/r', 'a', 'b')).map((f) => f.status)).toEqual([
      'added',
      'removed',
      'renamed',
      'modified',
    ]);
    expect(gh.cloneUrl('o/r')).toBe('https://github.com/o/r.git');
    expect(
      createGitHub({
        token: 'abcdef',
        fetch: mockHost({}).fetcher,
      }).cloneAuthHeader(),
    ).toMatch(/^Authorization: Basic /);
    expect(gh.cloneAuthHeader()).toBeUndefined();
  });

  it('reports API errors with status and no token', async () => {
    const gh = createGitHub({
      token: 'SECRETTOKEN',
      fetch: mockHost({}).fetcher,
    });
    const err = (await gh.getDefaultBranch('o/r').catch((e) => e)) as GitError;
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('SECRETTOKEN');
    await expect(gh.getBranchSha('o/r', 'main')).rejects.toThrow('not found');
    await expect(gh.getDefaultBranch('bad')).rejects.toThrow(
      'Not a repository',
    );
  });
});

describe('gitlab', () => {
  const P = '/api/v4/projects/g%2Fp';
  const routes = {
    [`GET ${P}`]: () => ({ default_branch: 'main' }),
    [`GET ${P}/repository/branches/main`]: () => ({ commit: { id: 'head1' } }),
    [`GET ${P}/repository/files/a.md`]: () => ({
      content: b64('# A'),
      blob_id: 'b1',
    }),
    [`GET ${P}/repository/tree`]: (u: URL) =>
      u.searchParams.get('page') === '1'
        ? new Response(
            JSON.stringify([
              { path: 'a.md', type: 'blob' },
              { path: 'd', type: 'tree' },
            ]),
            { headers: { 'x-next-page': '2' } },
          )
        : new Response(JSON.stringify([{ path: 'b.md', type: 'blob' }])),
    [`POST ${P}/repository/branches`]: () => ({}),
    [`POST ${P}/repository/commits`]: () => ({ id: 'c1' }),
    [`POST ${P}/merge_requests`]: () => ({
      web_url: 'https://gitlab.com/g/p/-/merge_requests/3',
      iid: 3,
    }),
    [`GET ${P}/repository/compare`]: () => ({
      diffs: [
        {
          new_path: 'n',
          new_file: true,
          deleted_file: false,
          renamed_file: false,
          diff: '+x',
        },
        {
          new_path: 'd',
          new_file: false,
          deleted_file: true,
          renamed_file: false,
        },
        {
          new_path: 'r',
          new_file: false,
          deleted_file: false,
          renamed_file: true,
        },
        {
          new_path: 'm',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
        },
      ],
    }),
  };
  it('reads, paginates, and uses the private token', async () => {
    const h = mockHost(routes);
    const gl = createGitLab({ token: 'glpat-xxxxxx', fetch: h.fetcher });
    expect(await gl.getDefaultBranch('g/p')).toBe('main');
    expect(await gl.getBranchSha('g/p', 'main')).toBe('head1');
    expect((await gl.readFile('g/p', 'a.md', 'main'))!.sha).toBe('b1');
    expect(await gl.readFile('g/p', 'zzz.md', 'main')).toBeUndefined();
    expect(await gl.listFiles('g/p', 'main')).toEqual(['a.md', 'b.md']);
    expect(h.calls[0]!.headers.get('private-token')).toBe('glpat-xxxxxx');
    expect(gl.cloneUrl('g/p')).toBe('https://gitlab.com/g/p.git');
  });
  it('chooses create vs update per file and sends last_commit_id', async () => {
    const h = mockHost(routes);
    const gl = createGitLab({ fetch: h.fetcher });
    expect(
      await gl.commit({
        repo: 'g/p',
        branch: 'main',
        message: 'm',
        changes: [
          { path: 'a.md', content: 'x' },
          { path: 'new.md', content: 'y' },
          { path: 'gone.md', delete: true },
        ],
        expectedHeadSha: 'head1',
      }),
    ).toBe('c1');
    const body = h.calls.find((c) => c.path.endsWith('/commits'))!.body;
    expect(body.actions.map((a: any) => a.action)).toEqual([
      'update',
      'create',
      'delete',
    ]);
    expect(body.last_commit_id).toBe('head1');
    await expect(
      gl.commit({
        repo: 'g/p',
        branch: 'main',
        message: 'm',
        changes: [],
        expectedHeadSha: 'stale',
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
  });
  it('maps a rejected last_commit_id to a conflict', async () => {
    const gl = createGitLab({
      fetch: mockHost({
        ...routes,
        [`POST ${P}/repository/commits`]: () =>
          new Response('{"message":"The last commit changed"}', {
            status: 400,
          }),
      }).fetcher,
    });
    await expect(
      gl.commit({
        repo: 'g/p',
        branch: 'main',
        message: 'm',
        changes: [{ path: 'a.md', content: 'x' }],
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
    const other = createGitLab({
      fetch: mockHost({
        ...routes,
        [`POST ${P}/repository/commits`]: () =>
          new Response('{"message":"bad"}', { status: 400 }),
      }).fetcher,
    });
    await expect(
      other.commit({
        repo: 'g/p',
        branch: 'main',
        message: 'm',
        changes: [{ path: 'a.md', content: 'x' }],
      }),
    ).rejects.toThrow('bad');
  });
  it('opens merge requests, branches and compares', async () => {
    const gl = createGitLab({ fetch: mockHost(routes).fetcher });
    expect(
      await gl.openPullRequest({
        repo: 'g/p',
        head: 'h',
        base: 'main',
        title: 't',
        body: 'b',
      }),
    ).toEqual({ url: 'https://gitlab.com/g/p/-/merge_requests/3', number: 3 });
    await gl.createBranch('g/p', 'x', 'head1');
    expect((await gl.compare('g/p', 'a', 'b')).map((f) => f.status)).toEqual([
      'added',
      'removed',
      'renamed',
      'modified',
    ]);
    await expect(gl.getBranchSha('g/p', 'nope')).rejects.toThrow('not found');
    expect(
      createGitLab({
        token: 'abcdef',
        fetch: mockHost({}).fetcher,
      }).cloneAuthHeader(),
    ).toMatch(/^Authorization: Basic /);
    expect(gl.cloneAuthHeader()).toBeUndefined();
  });
});

describe('memory git (the test double behaves like a host)', () => {
  it('branches, commits, conflicts, compares and opens PRs', async () => {
    const git = createMemoryGit();
    const s0 = git.seed('o/r', { 'docs/a.mdx': 'one', 'docs/b.mdx': 'two' });
    expect(await git.getDefaultBranch('o/r')).toBe('main');
    await git.createBranch('o/r', 'feat', s0);
    await expect(git.createBranch('o/r', 'feat', s0)).rejects.toThrow('exists');
    const c1 = await git.commit({
      repo: 'o/r',
      branch: 'feat',
      message: 'edit',
      changes: [
        { path: 'docs/a.mdx', content: 'ONE' },
        { path: 'docs/b.mdx', delete: true },
      ],
      expectedHeadSha: s0,
    });
    await expect(
      git.commit({
        repo: 'o/r',
        branch: 'feat',
        message: 'x',
        changes: [],
        expectedHeadSha: s0,
      }),
    ).rejects.toBeInstanceOf(GitConflictError);
    expect(git.snapshot('o/r', 'feat')).toEqual({ 'docs/a.mdx': 'ONE' });
    expect(git.snapshot('o/r', 'main')).toEqual({
      'docs/a.mdx': 'one',
      'docs/b.mdx': 'two',
    });
    expect(
      (await git.compare('o/r', 'main', 'feat')).map(
        (f) => `${f.status}:${f.path}`,
      ),
    ).toEqual(['modified:docs/a.mdx', 'removed:docs/b.mdx']);
    const pr = await git.openPullRequest({
      repo: 'o/r',
      head: 'feat',
      base: 'main',
      title: 't',
      body: 'b',
    });
    expect(pr.number).toBe(1);
    expect(git.pushes.map((p) => p.branch)).toEqual(['feat']);
    expect(await git.getBranchSha('o/r', 'feat')).toBe(c1);
    expect(await git.listFiles('o/r', 'main', 'docs')).toEqual([
      'docs/a.mdx',
      'docs/b.mdx',
    ]);
    expect(await git.readFile('o/r', 'nope', 'main')).toBeUndefined();
    await expect(git.getBranchSha('o/r', 'zzz')).rejects.toThrow();
    await expect(git.getDefaultBranch('x/y')).rejects.toThrow('not found');
    await expect(
      git.openPullRequest({
        repo: 'o/r',
        head: 'zzz',
        base: 'main',
        title: '',
        body: '',
      }),
    ).rejects.toThrow();
    const c2 = git.push('o/r', 'main', {
      'docs/new.mdx': 'n',
      'docs/a.mdx': null,
    });
    expect((await git.compare('o/r', s0, c2)).map((f) => f.status)).toEqual([
      'removed',
      'added',
    ]);
  });
});
