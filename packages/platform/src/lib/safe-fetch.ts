import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/** True for addresses a server-side fetch must never reach: loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (kind === 6) {
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (hexMapped) {
      const n = (parseInt(hexMapped[1]!, 16) << 16) | parseInt(hexMapped[2]!, 16);
      return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return (
      ip === '::' || ip === '::1' ||
      /^f[cd]/.test(ip) || // unique local fc00::/7
      /^fe[89ab]/.test(ip) || // link-local fe80::/10
      /^ff/.test(ip) // multicast
    );
  }
  return true; // not an address at all: refuse
}

export interface SafeFetchOptions {
  /** Hosts the administrator has chosen to trust (the Git providers). These may be on a private network. */
  allowHosts?: readonly string[];
  /** Permit private addresses and plain http. Development only. */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<string[]>;
  fetch?: typeof fetch;
  maxRedirects?: number;
  /** Largest response body to read, in bytes. */
  maxBytes?: number;
  timeoutMs?: number;
}

const defaultResolve = async (host: string) =>
  (await lookup(host, { all: true })).map((r) => r.address);

/**
 * A `fetch` for URLs that came from a user or a third party. It allows only http(s) without embedded
 * credentials, resolves the host and refuses private addresses, follows redirects by hand so every hop is checked,
 * and caps time and body size. Trusted hosts listed in `allowHosts` skip the address check.
 */
export function createSafeFetch({
  allowHosts = [],
  allowPrivate = false,
  resolve = defaultResolve,
  fetch: doFetch = fetch,
  maxRedirects = 3,
  maxBytes = 10 * 1024 * 1024,
  timeoutMs = 15_000,
}: SafeFetchOptions = {}) {
  const trusted = new Set(allowHosts.map((h) => h.toLowerCase()));

  async function check(raw: string | URL): Promise<URL> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UnsafeUrlError('Not a valid URL.');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (allowPrivate || trusted.has(url.hostname.toLowerCase()))))
      throw new UnsafeUrlError('Only https URLs are allowed.');
    if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed.');
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (trusted.has(host) || allowPrivate) return url;
    const addresses = isIP(host) ? [host] : await resolve(host);
    if (!addresses.length) throw new UnsafeUrlError('The host did not resolve.');
    if (addresses.some(isPrivateAddress))
      throw new UnsafeUrlError('The URL points at a private or reserved address.');
    return url;
  }

  async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    let url = await check(input);
    for (let hop = 0; ; hop++) {
      const res = await doFetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= maxRedirects) throw new UnsafeUrlError('Too many redirects.');
        url = await check(new URL(res.headers.get('location')!, url));
        // A redirect off the original host must not carry credentials along.
        if (init.headers && url.host !== new URL(input).host) init = { ...init, headers: stripAuth(init.headers) };
        continue;
      }
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > maxBytes) throw new UnsafeUrlError('The response is too large.');
      return res;
    }
  }

  /** Fetch and read the body as text, refusing more than `maxBytes`. */
  async function fetchText(input: string | URL, init?: RequestInit): Promise<{ status: number; text: string }> {
    const res = await safeFetch(input, init);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError('The response is too large.');
      }
      chunks.push(value);
    }
    return { status: res.status, text: Buffer.concat(chunks).toString('utf8') };
  }

  return Object.assign(safeFetch, { check, fetchText });
}

function stripAuth(headers: NonNullable<RequestInit["headers"]>): NonNullable<RequestInit["headers"]> {
  const h = new Headers(headers);
  h.delete('authorization');
  h.delete('private-token');
  h.delete('cookie');
  return h;
}
