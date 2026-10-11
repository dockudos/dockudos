export type ProviderId = 'github' | 'gitlab';

export interface FileChange {
  path: string;
  /** New content. Omit with `delete: true` to remove the file. */
  content?: Uint8Array | string;
  delete?: boolean;
}

export interface RepoFile {
  content: Uint8Array;
  /** Blob id: equal ids mean equal content. */
  sha: string;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  /** Unified diff, when the provider returns one (it leaves it out for large or binary files). */
  patch?: string;
}

export interface PullRequest {
  url: string;
  number: number;
}

export class GitError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitError';
    this.status = status;
  }
}

/** The branch moved while someone was editing. The caller should reload and merge. */
export class GitConflictError extends GitError {
  constructor(message = 'The branch changed since it was read.') {
    super(message, 409);
    this.name = 'GitConflictError';
  }
}

/**
 * Everything the platform needs from a Git host, over its REST API (no clone). GitHub and GitLab implement it;
 * a third host is one more file. Repositories are `owner/name` (GitLab allows nested groups).
 */
export interface GitProvider {
  id: ProviderId;
  /** The HTTPS clone URL, without credentials. */
  cloneUrl(repo: string): string;
  /** Value for `http.extraHeader` when cloning over HTTPS with the configured token. */
  cloneAuthHeader(): string | undefined;
  getDefaultBranch(repo: string): Promise<string>;
  getBranchSha(repo: string, branch: string): Promise<string>;
  readFile(repo: string, path: string, ref: string): Promise<RepoFile | undefined>;
  /** Every file path under `dir` at `ref`, recursively. */
  listFiles(repo: string, ref: string, dir?: string): Promise<string[]>;
  createBranch(repo: string, name: string, fromSha: string): Promise<void>;
  /**
   * One commit with all `changes` on `branch`; returns its sha. When `expectedHeadSha` is given and the branch
   * has moved, throws `GitConflictError` instead of committing over someone else's work.
   */
  commit(input: {
    repo: string;
    branch: string;
    message: string;
    changes: FileChange[];
    expectedHeadSha?: string;
  }): Promise<string>;
  openPullRequest(input: { repo: string; head: string; base: string; title: string; body: string }): Promise<PullRequest>;
  compare(repo: string, base: string, head: string): Promise<ChangedFile[]>;
}

const REPO = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;

export function assertRepo(repo: string): void {
  if (!REPO.test(repo) || repo.split('/').some((p) => p === '.' || p === '..'))
    throw new GitError(`Not a repository name: ${JSON.stringify(repo.slice(0, 80))}`, 400);
}

/** Repository-relative paths: no leading slash, no `..`, no backslash, no NUL. */
export function assertRepoPath(path: string): void {
  if (!path || path.startsWith('/') || /[\0\\]/.test(path) || path.split('/').some((p) => p === '..' || p === '.' || p === ''))
    throw new GitError(`Not a repository path: ${JSON.stringify(path.slice(0, 80))}`, 400);
}

export const toBytes = (c: Uint8Array | string): Uint8Array =>
  typeof c === 'string' ? new TextEncoder().encode(c) : c;
export const b64 = (c: Uint8Array | string): string => Buffer.from(toBytes(c)).toString('base64');
