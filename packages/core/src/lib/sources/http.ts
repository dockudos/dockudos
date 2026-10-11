import { SourceError } from './types.ts';

export type HttpFetch = typeof fetch;

/** `https` anywhere, `http` only for the machine itself. */
export function assertFetchable(url: string, what: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SourceError(`${what}: "${url}" is not a URL.`);
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
    throw new SourceError(
      `${what}: ${url} must be https (http is only allowed for localhost).`,
    );
  return u;
}

export interface GetOptions {
  fetch?: HttpFetch;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Largest body accepted, in bytes. */
  maxBytes?: number;
  method?: 'GET' | 'POST';
  body?: string;
}

/** Fetch with a size cap, a timeout, no redirects to other schemes, and a retry when the server says to slow down. */
export async function getBytes(
  url: string,
  what: string,
  o: GetOptions = {},
): Promise<Uint8Array> {
  assertFetchable(url, what);
  const f = o.fetch ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, {
      method: o.method ?? 'GET',
      headers: o.headers,
      body: o.body,
      signal: o.signal ?? AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && attempt < 3) {
      const asked = Number.parseFloat(res.headers.get('retry-after') ?? '');
      const wait = Math.min(Number.isFinite(asked) ? asked : 1, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok)
      throw new SourceError(`${what}: ${url} answered ${res.status}.`);
    const max = o.maxBytes ?? 5_000_000;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > max)
      throw new SourceError(`${what}: ${url} is larger than ${max} bytes.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > max)
      throw new SourceError(`${what}: ${url} is larger than ${max} bytes.`);
    return bytes;
  }
}

export async function getJson<T = unknown>(
  url: string,
  what: string,
  o: GetOptions = {},
): Promise<T> {
  const bytes = await getBytes(url, what, o);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new SourceError(`${what}: ${url} did not answer JSON.`);
  }
}

/**
 * Is this host the machine itself or a private network address, which a listing from outside has no business pointing at?
 * Checks names and address literals (`localhost`, `10.x`, `169.254.x`, `[::1]`, `*.internal`); it does not resolve names.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':'))
    return (
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    );
  return false;
}
