import { createHash } from 'node:crypto';
import {
  assertRepo, assertRepoPath, type ChangedFile, GitConflictError, GitError, type GitProvider,
  type ProviderId, type PullRequest, type RepoFile, toBytes,
} from './types.ts';

/**
 * An in-memory Git host with real commit semantics (branches point at commits; a commit is a full snapshot).
 * It is the stand-in for GitHub and GitLab in tests and in the self-hosting smoke test, and it records every
 * ref update so tests can assert what was pushed where.
 */
export function createMemoryGit(
  id: ProviderId = 'github',
  { defaultBranch = 'main' } = {},
) {
  interface Commit { sha: string; files: Map<string, Uint8Array>; parent?: string }
  const commits = new Map<string, Commit>();
  const repos = new Map<string, { branches: Map<string, string>; defaultBranch: string }>();
  const pulls: { repo: string; head: string; base: string; title: string; body: string; number: number }[] = [];
  const pushes: { repo: string; branch: string; sha: string }[] = [];
  let n = 0;
  const sha = (seed: string) => createHash('sha1').update(`${seed}:${n++}`).digest('hex');
  const repo = (name: string) => {
    assertRepo(name);
    const r = repos.get(name);
    if (!r) throw new GitError(`Repository ${name} not found.`, 404);
    return r;
  };
  const at = (name: string, ref: string): Commit => {
    const r = repo(name);
    const c = commits.get(r.branches.get(ref) ?? ref);
    if (!c) throw new GitError(`Ref ${ref} not found.`, 404);
    return c;
  };
  const blob = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

  const provider: GitProvider = {
    id,
    cloneUrl: (name) => `https://git.test/${name}.git`,
    cloneAuthHeader: () => undefined,
    async getDefaultBranch(name) { return repo(name).defaultBranch; },
    async getBranchSha(name, branch) {
      const s = repo(name).branches.get(branch);
      if (!s) throw new GitError(`Branch ${branch} not found.`, 404);
      return s;
    },
    async readFile(name, path, ref): Promise<RepoFile | undefined> {
      assertRepoPath(path);
      const f = at(name, ref).files.get(path);
      return f ? { content: f, sha: blob(f) } : undefined;
    },
    async listFiles(name, ref, dir = '') {
      const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
      return [...at(name, ref).files.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
    async createBranch(name, branch, from) {
      const r = repo(name);
      if (r.branches.has(branch)) throw new GitError(`Branch ${branch} exists.`, 422);
      if (!commits.has(from)) throw new GitError('Unknown commit.', 404);
      r.branches.set(branch, from);
    },
    async commit({ repo: name, branch, message, changes, expectedHeadSha }) {
      const r = repo(name);
      const head = r.branches.get(branch);
      if (!head) throw new GitError(`Branch ${branch} not found.`, 404);
      if (expectedHeadSha && head !== expectedHeadSha) throw new GitConflictError();
      const files = new Map(commits.get(head)!.files);
      for (const c of changes) {
        assertRepoPath(c.path);
        if (c.delete) files.delete(c.path);
        else files.set(c.path, toBytes(c.content ?? ''));
      }
      const s = sha(message);
      commits.set(s, { sha: s, files, parent: head });
      r.branches.set(branch, s);
      pushes.push({ repo: name, branch, sha: s });
      return s;
    },
    async openPullRequest({ repo: name, head, base, title, body }): Promise<PullRequest> {
      const r = repo(name);
      if (!r.branches.has(head) || !r.branches.has(base)) throw new GitError('Unknown branch.', 422);
      const number = pulls.length + 1;
      pulls.push({ repo: name, head, base, title, body, number });
      return { url: `https://git.test/${name}/pull/${number}`, number };
    },
    async compare(name, base, head): Promise<ChangedFile[]> {
      const a = at(name, base).files;
      const b = at(name, head).files;
      const out: ChangedFile[] = [];
      for (const [p, content] of b) {
        const old = a.get(p);
        if (!old) out.push({ path: p, status: 'added', patch: [...new TextDecoder().decode(content).split('\n')].map((l) => `+${l}`).join('\n') });
        else if (blob(old) !== blob(content)) out.push({ path: p, status: 'modified', patch: `-${new TextDecoder().decode(old)}\n+${new TextDecoder().decode(content)}` });
      }
      for (const p of a.keys()) if (!b.has(p)) out.push({ path: p, status: 'removed' });
      return out.sort((x, y) => x.path.localeCompare(y.path));
    },
  };

  return Object.assign(provider, {
    pulls,
    pushes,
    /** Create a repository with a first commit on the default branch. Returns that commit's sha. */
    seed(name: string, files: Record<string, string>): string {
      const s = sha('seed');
      commits.set(s, { sha: s, files: new Map(Object.entries(files).map(([p, c]) => [p, toBytes(c)])) });
      repos.set(name, { branches: new Map([[defaultBranch, s]]), defaultBranch });
      return s;
    },
    /** Commit to a branch as if a person had pushed. Not recorded in `pushes`. */
    push(name: string, branch: string, files: Record<string, string | null>): string {
      const r = repo(name);
      const head = r.branches.get(branch)!;
      const next = new Map(commits.get(head)!.files);
      for (const [p, c] of Object.entries(files)) {
        if (c === null) next.delete(p);
        else next.set(p, toBytes(c));
      }
      const s = sha('push');
      commits.set(s, { sha: s, files: next, parent: head });
      r.branches.set(branch, s);
      return s;
    },
    branches: (name: string) => Object.fromEntries(repo(name).branches),
    snapshot: (name: string, ref: string) => Object.fromEntries([...at(name, ref).files].map(([p, c]) => [p, new TextDecoder().decode(c)])),
  });
}

export type MemoryGit = ReturnType<typeof createMemoryGit>;
