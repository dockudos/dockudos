export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  identity: { name: string; email: string } | null;
}
export interface Project {
  name: string;
  dir: string;
  hasConfig: boolean;
  files: string[];
  git: GitInfo;
}
export interface Change {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  staged: boolean;
  from?: string;
}
export interface CommitInfo {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let token = '';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  raw?: { data: Blob; type: string },
): Promise<T> {
  if (!token && method !== 'GET') {
    const s = (await (await fetch('/api/session')).json()) as {
      token: string;
    };
    token = s.token;
  }
  const res = await fetch(path, {
    method,
    headers: {
      ...(token && { 'x-dockudos-token': token }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(raw
      ? { body: raw.data }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(
      String(data['error'] ?? `Request failed (${res.status})`),
      res.status,
      data,
    );
  return data as T;
}

const q = (s: string) => encodeURIComponent(s);

export const api = {
  project: () => request<Project>('GET', '/api/project'),
  read: (path: string) =>
    request<{ path: string; content: string; hash: string }>(
      'GET',
      `/api/file?path=${q(path)}`,
    ),
  write: (path: string, content: string, baseHash?: string) =>
    request<{ hash: string }>('PUT', '/api/file', { path, content, baseHash }),
  createPage: (id: string, title: string) =>
    request<{ path: string; touched: string[] }>('POST', '/api/page', {
      id,
      title,
    }),
  movePage: (from: string, to: string) =>
    request<{ path: string; touched: string[] }>('POST', '/api/move', {
      from,
      to,
    }),
  remove: (path: string) =>
    request<{ touched: string[] }>('DELETE', `/api/file?path=${q(path)}`),
  upload: (file: File) =>
    request<{ path: string; url: string }>(
      'POST',
      `/api/media?name=${q(file.name)}`,
      undefined,
      { data: file, type: file.type },
    ),
  status: () => request<{ changes: Change[] }>('GET', '/api/git/status'),
  diff: (path: string) =>
    request<{ diff: string }>('GET', `/api/git/diff?path=${q(path)}`),
  log: () => request<{ commits: CommitInfo[] }>('GET', '/api/git/log?limit=15'),
  commit: (message: string, paths: string[]) =>
    request<{ sha: string; committed: string[] }>('POST', '/api/git/commit', {
      message,
      paths,
    }),
  discard: (paths: string[]) =>
    request<{ ok: true }>('POST', '/api/git/discard', { paths }),
  gitInit: () => request<Project>('POST', '/api/git/init'),
};

/** The page address (`guides/start`) of a file path (`docs/guides/start.mdx`). */
export const pageId = (path: string) =>
  path.replace(/^docs\//, '').replace(/\.mdx?$/, '');
