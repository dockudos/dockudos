import { GitError } from './types.ts';

export type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** JSON over a Git host's API. Errors carry the status and the host's message, never the token. */
export function createApi(base: string, headers: Record<string, string>, fetcher: Fetcher) {
  async function call<T>(method: string, path: string, body?: unknown, { allow404 = false } = {}): Promise<{ data: T | undefined; res: Response }> {
    const res = await fetcher(`${base}${path}`, {
      method,
      headers: { accept: 'application/json', ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 404 && allow404) return { data: undefined, res };
    if (!res.ok) {
      let message = '';
      try {
        const j = (await res.json()) as { message?: unknown; error?: unknown };
        message = String(j.message ?? j.error ?? '');
      } catch {
        /* not JSON */
      }
      throw new GitError(`${method} ${path.split('?')[0]} failed: ${res.status} ${message}`.trim(), res.status);
    }
    return { data: res.status === 204 ? undefined : ((await res.json()) as T), res };
  }
  return {
    get: <T>(path: string, opts?: { allow404?: boolean }) => call<T>('GET', path, undefined, opts),
    post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
    patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  };
}
