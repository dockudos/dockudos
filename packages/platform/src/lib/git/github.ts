import { createApi, type Fetcher } from './http.ts';
import {
  assertRepo,
  assertRepoPath,
  b64,
  type ChangedFile,
  type FileChange,
  GitConflictError,
  GitError,
  type GitProvider,
  type PullRequest,
  type RepoFile,
  toBytes,
} from './types.ts';

export interface GitHubOptions {
  token?: string;
  apiUrl?: string;
  /** Used for `cloneUrl`. Default: https://github.com */
  webUrl?: string;
  fetch: Fetcher;
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function createGitHub({
  token,
  apiUrl = 'https://api.github.com',
  webUrl = 'https://github.com',
  fetch: fetcher,
}: GitHubOptions): GitProvider {
  const api = createApi(
    apiUrl.replace(/\/+$/, ''),
    {
      'x-github-api-version': '2022-11-28',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    fetcher,
  );
  const r = (repo: string) => {
    assertRepo(repo);
    return `/repos/${repo}`;
  };
  return {
    id: 'github',
    cloneUrl: (repo) => (
      assertRepo(repo),
      `${webUrl.replace(/\/+$/, '')}/${repo}.git`
    ),
    cloneAuthHeader: () =>
      token
        ? `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
        : undefined,

    async getDefaultBranch(repo) {
      return (await api.get<{ default_branch: string }>(r(repo))).data!
        .default_branch;
    },
    async getBranchSha(repo, branch) {
      const { data } = await api.get<{ object: { sha: string } }>(
        `${r(repo)}/git/ref/heads/${enc(branch)}`,
        { allow404: true },
      );
      if (!data) throw new GitError(`Branch ${branch} not found.`, 404);
      return data.object.sha;
    },
    async readFile(repo, path, ref): Promise<RepoFile | undefined> {
      assertRepoPath(path);
      const { data } = await api.get<{
        content?: string;
        encoding?: string;
        sha: string;
        type?: string;
      }>(`${r(repo)}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, {
        allow404: true,
      });
      if (
        !data ||
        data.type === 'dir' ||
        Array.isArray(data) ||
        data.content === undefined
      )
        return undefined;
      return {
        content: new Uint8Array(Buffer.from(data.content, 'base64')),
        sha: data.sha,
      };
    },
    async listFiles(repo, ref, dir = '') {
      const { data } = await api.get<{
        tree: { path: string; type: string }[];
        truncated?: boolean;
      }>(`${r(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      if (data!.truncated)
        throw new GitError(
          'The repository is too large to list through the API.',
          413,
        );
      const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
      return data!.tree
        .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
        .map((e) => e.path);
    },
    async createBranch(repo, name, fromSha) {
      await api.post(`${r(repo)}/git/refs`, {
        ref: `refs/heads/${name}`,
        sha: fromSha,
      });
    },
    async commit({ repo, branch, message, changes, expectedHeadSha }) {
      const base = r(repo);
      for (const c of changes) assertRepoPath(c.path);
      const head = await this.getBranchSha(repo, branch);
      if (expectedHeadSha && head !== expectedHeadSha)
        throw new GitConflictError();
      const parent = (
        await api.get<{ tree: { sha: string } }>(`${base}/git/commits/${head}`)
      ).data!;
      const tree: unknown[] = [];
      for (const c of changes as FileChange[]) {
        if (c.delete)
          tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
        else {
          const blob = await api.post<{ sha: string }>(`${base}/git/blobs`, {
            content: b64(c.content ?? ''),
            encoding: 'base64',
          });
          tree.push({
            path: c.path,
            mode: '100644',
            type: 'blob',
            sha: blob.data!.sha,
          });
        }
      }
      const newTree = await api.post<{ sha: string }>(`${base}/git/trees`, {
        base_tree: parent.tree.sha,
        tree,
      });
      const commit = await api.post<{ sha: string }>(`${base}/git/commits`, {
        message,
        tree: newTree.data!.sha,
        parents: [head],
      });
      try {
        // force: false makes the update fast-forward only, so a push that raced ours is refused, not overwritten.
        await api.patch(`${base}/git/refs/heads/${enc(branch)}`, {
          sha: commit.data!.sha,
          force: false,
        });
      } catch (e) {
        if (e instanceof GitError && e.status === 422)
          throw new GitConflictError();
        throw e;
      }
      return commit.data!.sha;
    },
    async openPullRequest({
      repo,
      head,
      base,
      title,
      body,
    }): Promise<PullRequest> {
      const { data } = await api.post<{ html_url: string; number: number }>(
        `${r(repo)}/pulls`,
        { title, head, base, body },
      );
      return { url: data!.html_url, number: data!.number };
    },
    async reportStatus({ repo, sha, state, url, description }) {
      await api.post(`${r(repo)}/statuses/${encodeURIComponent(sha)}`, {
        state,
        description: description.slice(0, 140),
        context: 'dockudos/build',
        ...(url && { target_url: url }),
      });
    },
    async compare(repo, base, head): Promise<ChangedFile[]> {
      const { data } = await api.get<{
        files?: { filename: string; status: string; patch?: string }[];
      }>(
        `${r(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      );
      return (data!.files ?? []).map((f) => ({
        path: f.filename,
        status:
          f.status === 'added'
            ? 'added'
            : f.status === 'removed'
              ? 'removed'
              : f.status === 'renamed'
                ? 'renamed'
                : 'modified',
        ...(f.patch && { patch: f.patch }),
      }));
    },
  };
}

export { toBytes };
