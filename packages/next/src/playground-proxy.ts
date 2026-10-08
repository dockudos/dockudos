import { createRateLimiter } from '@dockudos/core';
import { readFile, readdir } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { apiError, clientKey, json } from './api-common.ts';
import { getSite } from './server.ts';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** Headers that describe the hop to the proxy, not the request being made, or that carry the site's identity. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'te',
  'trailer',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
]);

/** Is this IP address one a public API should never resolve to: loopback, private, link-local, reserved? */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb') ||
    /^f[cd]/.test(v6)
  );
}

/** A matcher for the hosts of a server URL; `{variables}` stand for one label. `undefined` when the host is only a variable. */
export function hostMatcher(
  serverUrl: string,
): ((host: string) => boolean) | undefined {
  const token = 'x-var-x';
  let url: URL;
  try {
    url = new URL(serverUrl.replace(/\{[^}]+\}/g, token));
  } catch {
    return undefined;
  }
  if (url.hostname === token) return undefined;
  const pattern = url.host
    .toLowerCase()
    .split(token)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]+');
  const regex = new RegExp(`^${pattern}$`);
  return (host) => regex.test(host.toLowerCase());
}

/** The server URLs of every generated OpenAPI source (written by `dockudos generate`). */
async function generatedServers(root: string): Promise<string[]> {
  const base = join(root, '.dockudos', 'api');
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return [];
  }
  const lists = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(
          await readFile(join(base, name, 'servers.json'), 'utf8'),
        ) as string[];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

export interface PlaygroundProxyOptions {
  /** `fetch`, for tests. */
  fetch?: typeof fetch;
  /** DNS lookup, for tests. */
  lookup?: (host: string) => Promise<{ address: string }[]>;
}

interface Payload {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

function parsePayload(raw: unknown): Payload | string {
  if (typeof raw !== 'object' || raw === null) return 'Send a JSON object.';
  const o = raw as Record<string, unknown>;
  if (typeof o.method !== 'string' || !/^[A-Z]{3,8}$/.test(o.method))
    return 'The method is not valid.';
  if (typeof o.url !== 'string') return 'The url is missing.';
  if (!Array.isArray(o.headers)) return 'The headers must be a list.';
  const headers: [string, string][] = [];
  for (const h of o.headers) {
    if (
      !Array.isArray(h) ||
      typeof h[0] !== 'string' ||
      typeof h[1] !== 'string'
    )
      return 'A header is not valid.';
    // Names and values that cannot be put on the wire are rejected here, not by whatever is in between.
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h[0]) || /[\r\n]/.test(h[1]))
      return `The header "${h[0]}" is not valid.`;
    headers.push([h[0], h[1]]);
  }
  if (o.body !== undefined && typeof o.body !== 'string')
    return 'The body must be text.';
  return {
    method: o.method,
    url: o.url,
    headers,
    body: o.body as string | undefined,
  };
}

/**
 * `POST /api/playground`: send a playground request on behalf of the browser, for APIs that do not allow CORS.
 * Only available with `openapi.playground.proxy` on. It forwards to the hosts of the spec's servers and of
 * `openapi.playground.allowedHosts` and nowhere else, never follows a redirect, refuses addresses on private networks
 * unless the host is listed in `allowedHosts`, and answers only requests from the site itself.
 */
export function createPlaygroundHandler({
  fetch: doFetch = fetch,
  lookup = (host) => dnsLookup(host, { all: true }),
}: PlaygroundProxyOptions = {}) {
  const limiter = createRateLimiter({ limit: 30 });
  let servers: Promise<string[]> | undefined;

  return async function POST(request: Request): Promise<Response> {
    const site = await getSite();
    const { proxy, allowedHosts } = site.config.openapi.playground;
    if (!proxy) {
      return apiError(
        404,
        'The playground proxy is off. Set "openapi.playground.proxy" in docs.json to use it.',
      );
    }

    // Only the site's own pages may use it: a page of another site could otherwise spend this server's reach.
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (
      request.headers.get('x-dockudos-playground') !== '1' ||
      (origin && new URL(origin).host !== host)
    ) {
      return apiError(403, 'The proxy only answers requests from this site.');
    }

    const turn = limiter.take(clientKey(request));
    if (!turn.allowed) {
      return apiError(
        429,
        `Too many requests. Try again in ${turn.retryAfter} seconds.`,
        {
          'retry-after': String(turn.retryAfter),
        },
      );
    }

    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES)
      return apiError(413, 'The request is too large.');
    let payload: Payload | string;
    try {
      payload = parsePayload(JSON.parse(text));
    } catch {
      payload = 'Send JSON.';
    }
    if (typeof payload === 'string') return apiError(400, payload);

    let target: URL;
    try {
      target = new URL(payload.url);
    } catch {
      return apiError(400, 'The url is not valid.');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:')
      return apiError(400, 'Only http and https URLs can be called.');
    if (target.username || target.password)
      return apiError(400, 'Put credentials in headers, not in the URL.');

    const explicit = allowedHosts.map((h) => h.toLowerCase());
    const isExplicit =
      explicit.includes(target.host.toLowerCase()) ||
      explicit.includes(target.hostname.toLowerCase());
    if (!isExplicit) {
      servers ??= generatedServers(site.root);
      const matchers = (await servers)
        .map(hostMatcher)
        .filter((m): m is NonNullable<typeof m> => !!m);
      if (!matchers.some((m) => m(target.host))) {
        return apiError(
          403,
          `${target.host} is not a server of any API in the docs. Add it to "openapi.playground.allowedHosts" to allow it.`,
        );
      }
      // A name from the spec must not point into the private network (checked again for each address it has).
      const addresses = isIP(target.hostname)
        ? [{ address: target.hostname.replace(/^\[|\]$/g, '') }]
        : await lookup(target.hostname).catch(() => []);
      if (!addresses.length)
        return apiError(502, `${target.hostname} could not be found.`);
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        return apiError(
          403,
          `${target.hostname} is on a private network. Add it to "openapi.playground.allowedHosts" if that is intended.`,
        );
      }
    }

    const headers = new Headers();
    for (const [k, v] of payload.headers) {
      if (!DROPPED_REQUEST_HEADERS.has(k.toLowerCase())) headers.append(k, v);
    }
    headers.set('user-agent', 'dockudos-playground');

    let upstream: Response;
    try {
      upstream = await doFetch(target, {
        method: payload.method,
        headers,
        body:
          payload.method === 'GET' || payload.method === 'HEAD'
            ? undefined
            : payload.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'TimeoutError';
      return apiError(
        504,
        timedOut
          ? 'The API did not answer in time.'
          : `The API could not be reached: ${(e as Error).message}`,
      );
    }

    const bytes = await readLimited(upstream, MAX_RESPONSE_BYTES);
    if (!bytes)
      return apiError(502, 'The answer is larger than the proxy passes on.');
    const type = upstream.headers.get('content-type') ?? '';
    const binary = /^(image|audio|video)\/|octet-stream|zip|pdf|protobuf/i.test(
      type,
    );
    return json(
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: [...upstream.headers.entries()],
        body: binary
          ? Buffer.from(bytes).toString('base64')
          : new TextDecoder().decode(bytes),
        encoding: binary ? 'base64' : 'utf8',
      },
      200,
      { 'cache-control': 'no-store' },
    );
  };
}

async function readLimited(
  response: Response,
  max: number,
): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
