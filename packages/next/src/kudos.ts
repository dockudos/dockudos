import type { KudosEntry } from '@dockudos/core';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getSite } from './server.ts';

/** Where feedback is kept. Replace it to use a database; the handler only calls `add`. */
export interface KudosStore {
  add(entry: KudosEntry): Promise<void>;
}

/** Append JSON lines to a file. Fine for one server; use your own store on serverless hosts. */
export function fileKudosStore(file = '.dockudos/kudos.jsonl'): KudosStore {
  const path = resolve(process.cwd(), file);
  return {
    async add(entry) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(entry) + '\n');
    },
  };
}

export interface KudosHandlerOptions {
  store?: KudosStore;
  /** Is this a page of the site? Defaults to checking the docs folder, so garbage paths are refused. */
  isKnownPath?: (path: string) => boolean | Promise<boolean>;
  /** Longest comment kept, in characters. Default 1000. */
  maxCommentLength?: number;
  /** Requests allowed per client per minute. Default 20. */
  rateLimitPerMinute?: number;
  /** Clock, for tests. */
  now?: () => number;
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8 * 1024;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * A `POST` route handler for votes and comments.
 *
 *     // src/app/api/kudos/route.ts
 *     export const POST = createKudosHandler();
 *
 * Body: `{ path, vote: "up" | "down" }` creates a vote and answers `{ id }`;
 * `{ path, id, comment }` adds a comment to it. No IP address or other identifier is stored.
 * Requests from another origin are refused, and each client is rate limited in memory.
 */
export function createKudosHandler(options: KudosHandlerOptions = {}) {
  const {
    store = fileKudosStore(),
    maxCommentLength = 1000,
    rateLimitPerMinute = 20,
    now = Date.now,
  } = options;
  const isKnownPath =
    options.isKnownPath ??
    (async (path: string) =>
      (await getSite()).tree.pages.some((p) => p.path === path));
  const hits = new Map<string, number[]>();

  return async function POST(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (origin && new URL(origin).host !== host)
      return json({ error: 'cross-origin request' }, 403);

    const client =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const t = now();
    const recent = (hits.get(client) ?? []).filter((at) => t - at < 60_000);
    if (recent.length >= rateLimitPerMinute) {
      return json({ error: 'too many requests' }, 429, { 'retry-after': '60' });
    }
    hits.set(client, [...recent, t]);
    if (hits.size > 5000)
      for (const [k, v] of hits)
        if (v.every((at) => t - at >= 60_000)) hits.delete(k);

    if (
      !(request.headers.get('content-type') ?? '').includes('application/json')
    ) {
      return json({ error: 'expected application/json' }, 415);
    }
    const text = await request.text();
    if (text.length > MAX_BODY)
      return json({ error: 'request too large' }, 413);

    let body: {
      path?: unknown;
      vote?: unknown;
      id?: unknown;
      comment?: unknown;
    };
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object')
      return json({ error: 'invalid body' }, 400);

    const { path, vote, id, comment } = body;
    if (
      typeof path !== 'string' ||
      path.length > 300 ||
      !path.startsWith('/') ||
      !(await isKnownPath(path))
    ) {
      return json({ error: 'unknown page' }, 400);
    }
    const at = new Date(t).toISOString();

    if (vote !== undefined) {
      if (vote !== 'up' && vote !== 'down')
        return json({ error: 'vote must be "up" or "down"' }, 400);
      const entry: KudosEntry = { id: crypto.randomUUID(), at, path, vote };
      await store.add(entry);
      return json({ id: entry.id }, 201);
    }

    if (typeof id !== 'string' || !UUID.test(id))
      return json({ error: 'send a vote, or a comment with its id' }, 400);
    if (typeof comment !== 'string' || !comment.trim())
      return json({ error: 'comment is empty' }, 400);
    // Control characters other than newline and tab have no place in feedback text.
    const clean = comment.replace(CONTROL_CHARS, '').trim();
    if (clean.length > maxCommentLength)
      return json(
        { error: `comment is longer than ${maxCommentLength} characters` },
        400,
      );
    await store.add({ id, at, path, comment: clean });
    return json({ id }, 201);
  };
}
