import type { HttpRequest } from '@dockudos/core';

export interface PlaygroundResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  /** The body as text, cut at `MAX_SHOWN` characters. */
  body: string;
  /** The size of the whole body in bytes. */
  size: number;
  truncated: boolean;
  /** Not text: only its size is shown. */
  binary: boolean;
  ms: number;
}

export type SendOutcome =
  | { ok: true; response: PlaygroundResponse }
  | { ok: false; message: string; hint?: string };

export const MAX_SHOWN = 200_000;
/** Request headers a browser does not let a page set. They are dropped and the person is told. */
const FORBIDDEN = new Set(['cookie', 'host', 'content-length', 'user-agent', 'origin', 'referer', 'connection']);

export interface SendOptions {
  /** Send through the site's proxy route instead of straight to the API. */
  proxy?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Give up after this long. Default 30 s. */
  timeoutMs?: number;
}

/** What the browser says when it blocks a request before it is sent or hides the answer. */
export const CORS_HINT =
  'The browser blocked the request or its answer. Usual causes: the API does not allow requests from this site (CORS: it must answer with an Access-Control-Allow-Origin header for this site and allow the headers you sent), the API is not reachable from this machine, or this page is on https and the API on http. Fix CORS on the API, or turn on playground.proxy in docs.json to send requests through your site (read the warnings in the documentation first).';

const looksBinary = (type: string) =>
  /^(image|audio|video)\/|octet-stream|zip|pdf|protobuf/i.test(type);

/** Send a request from the browser. The credentials in it go to the URL in it and nowhere else. */
export async function sendRequest(
  request: HttpRequest,
  { proxy, fetch: doFetch = fetch, signal, timeoutMs = 30_000 }: SendOptions = {},
): Promise<SendOutcome> {
  const headers = request.headers.filter(([k]) => !FORBIDDEN.has(k.toLowerCase()));
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const started = performance.now();
  let response: Response;
  try {
    response = proxy
      ? await doFetch(proxy, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dockudos-playground': '1' },
          body: JSON.stringify({ method: request.method, url: request.url, headers, body: request.body?.text }),
          signal: combined,
        })
      : await doFetch(request.url, {
          method: request.method,
          headers,
          body: request.body && request.method !== 'GET' && request.method !== 'HEAD' ? request.body.text : undefined,
          // Never send the site's own cookies to somebody else's API.
          credentials: 'omit',
          signal: combined,
        });
  } catch (e) {
    if (timeout.aborted) return { ok: false, message: `No answer after ${timeoutMs / 1000} seconds.` };
    if (signal?.aborted) return { ok: false, message: 'The request was cancelled.' };
    return { ok: false, message: 'The request could not be sent.', hint: CORS_HINT };
  }

  if (proxy) return readProxied(response, started);

  const type = response.headers.get('content-type') ?? '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: true,
    response: describe({
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      bytes,
      binary: looksBinary(type),
      ms: performance.now() - started,
    }),
  };
}

async function readProxied(response: Response, started: number): Promise<SendOutcome> {
  let payload: {
    error?: string;
    status?: number;
    statusText?: string;
    headers?: [string, string][];
    body?: string;
    encoding?: 'utf8' | 'base64';
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, message: `The proxy answered ${response.status} without a usable body.` };
  }
  if (!response.ok || payload.status === undefined) {
    return { ok: false, message: payload.error ?? `The proxy answered ${response.status}.` };
  }
  const base64 = payload.encoding === 'base64';
  const bytes = base64
    ? Uint8Array.from(atob(payload.body ?? ''), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(payload.body ?? '');
  return {
    ok: true,
    response: describe({
      status: payload.status,
      statusText: payload.statusText ?? '',
      headers: payload.headers ?? [],
      bytes,
      binary: base64,
      ms: performance.now() - started,
    }),
  };
}

function describe(input: {
  status: number;
  statusText: string;
  headers: [string, string][];
  bytes: Uint8Array;
  binary: boolean;
  ms: number;
}): PlaygroundResponse {
  const { bytes, binary } = input;
  const text = binary ? '' : new TextDecoder().decode(bytes);
  return {
    status: input.status,
    statusText: input.statusText,
    headers: input.headers,
    body: text.slice(0, MAX_SHOWN),
    size: bytes.length,
    truncated: text.length > MAX_SHOWN,
    binary,
    ms: input.ms,
  };
}

/** The body as it is shown: JSON indented, anything else as it is. */
export function formatBody(body: string, contentType: string | undefined): string {
  if (/json/i.test(contentType ?? '') || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

/** The names of headers that were left out of the request because a browser does not allow them. */
export const droppedHeaders = (headers: [string, string][]): string[] =>
  headers.filter(([k]) => FORBIDDEN.has(k.toLowerCase())).map(([k]) => k);
