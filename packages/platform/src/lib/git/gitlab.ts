import { createApi, type Fetcher } from './http.ts';
import {
  assertRepo,
  assertRepoPath,
  b64,
  type ChangedFile,
  GitConflictError,
  GitError,
  type GitProvider,
  type PullRequest,
  type RepoFile,
} from './types.ts';

export interface GitLabOptions {
  token?: string;
  apiUrl?: string;
  webUrl?: string;
  fetch: Fetcher;
}

export function createGitLab({
  token,
  apiUrl = 'https://gitlab.com/api/v4',
  webUrl,
  fetch: fetcher,
}: GitLabOptions): GitProvider {
  const base = apiUrl.replace(/\/+$/, '');
  const web = (webUrl ?? new URL(base).origin).replace(/\/+$/, '');
  const api = createApi(base, token ? { 'private-token': token } : {}, fetcher);
  const p = (repo: string) => (
    assertRepo(repo),
    `/projects/${encodeURIComponent(repo)}`
  );
  const q = encodeURIComponent;

  async function exists(repo: string, path: string, ref: string) {
    return (await provider.readFile(repo, path, ref)) !== undefined;
  }

  const provider: GitProvider = {
    id: 'gitlab',
    cloneUrl: (repo) => (assertRepo(repo), `${web}/${repo}.git`),
    cloneAuthHeader: () =>
      token
        ? `Authorization: Basic ${Buffer.from(`oauth2:${token}`).toString('base64')}`
        : undefined,

    async getDefaultBranch(repo) {
      return (await api.get<{ default_branch: string }>(p(repo))).data!
        .default_branch;
    },
    async getBranchSha(repo, branch) {
      const { data } = await api.get<{ commit: { id: string } }>(
        `${p(repo)}/repository/branches/${q(branch)}`,
        { allow404: true },
      );
      if (!data) throw new GitError(`Branch ${branch} not found.`, 404);
      return data.commit.id;
    },
    async readFile(repo, path, ref): Promise<RepoFile | undefined> {
      assertRepoPath(path);
      const { data } = await api.get<{ content: string; blob_id: string }>(
        `${p(repo)}/repository/files/${q(path)}?ref=${q(ref)}`,
        { allow404: true },
      );
      if (!data) return undefined;
      return {
        content: new Uint8Array(Buffer.from(data.content, 'base64')),
        sha: data.blob_id,
      };
    },
    async listFiles(repo, ref, dir = '') {
      const out: string[] = [];
      for (let page = 1; page <= 200; page++) {
        const { data, res } = await api.get<{ path: string; type: string }[]>(
          `${p(repo)}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${q(ref)}${dir ? `&path=${q(dir.replace(/\/+$/, ''))}` : ''}`,
        );
        out.push(...data!.filter((e) => e.type === 'blob').map((e) => e.path));
        if (!res.headers.get('x-next-page')) break;
      }
      return out;
    },
    async createBranch(repo, name, fromSha) {
      await api.post(
        `${p(repo)}/repository/branches?branch=${q(name)}&ref=${q(fromSha)}`,
      );
    },
    async commit({ repo, branch, message, changes, expectedHeadSha }) {
      for (const c of changes) assertRepoPath(c.path);
      const head = await provider.getBranchSha(repo, branch);
      if (expectedHeadSha && head !== expectedHeadSha)
        throw new GitConflictError();
      const actions = [];
      for (const c of changes) {
        if (c.delete) actions.push({ action: 'delete', file_path: c.path });
        else
          actions.push({
            action: (await exists(repo, c.path, head)) ? 'update' : 'create',
            file_path: c.path,
            content: b64(c.content ?? ''),
            encoding: 'base64',
          });
      }
      try {
        const { data } = await api.post<{ id: string }>(
          `${p(repo)}/repository/commits`,
          {
            branch,
            commit_message: message,
            actions,
            ...(expectedHeadSha && { last_commit_id: expectedHeadSha }),
          },
        );
        return data!.id;
      } catch (e) {
        if (
          e instanceof GitError &&
          e.status === 400 &&
          /last commit|conflict|changed/i.test(e.message)
        )
          throw new GitConflictError();
        throw e;
      }
    },
    async openPullRequest({
      repo,
      head,
      base: target,
      title,
      body,
    }): Promise<PullRequest> {
      const { data } = await api.post<{ web_url: string; iid: number }>(
        `${p(repo)}/merge_requests`,
        {
          source_branch: head,
          target_branch: target,
          title,
          description: body,
        },
      );
      return { url: data!.web_url, number: data!.iid };
    },
    async reportStatus({ repo, sha, state, url, description }) {
      const params = new URLSearchParams({
        state:
          state === 'failure'
            ? 'failed'
            : state === 'pending'
              ? 'running'
              : 'success',
        name: 'dockudos/build',
        description: description.slice(0, 140),
      });
      if (url) params.set('target_url', url);
      await api.post(`${p(repo)}/statuses/${q(sha)}?${params}`);
    },
    async compare(repo, base: string, head: string): Promise<ChangedFile[]> {
      const { data } = await api.get<{
        diffs?: {
          new_path: string;
          new_file: boolean;
          deleted_file: boolean;
          renamed_file: boolean;
          diff?: string;
        }[];
      }>(`${p(repo)}/repository/compare?from=${q(base)}&to=${q(head)}`);
      return (data!.diffs ?? []).map((d) => ({
        path: d.new_path,
        status: d.new_file
          ? 'added'
          : d.deleted_file
            ? 'removed'
            : d.renamed_file
              ? 'renamed'
              : 'modified',
        ...(d.diff && { patch: d.diff }),
      }));
    },
  };
  return provider;
}
