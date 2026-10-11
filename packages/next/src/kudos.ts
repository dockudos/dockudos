import type { KudosEntry } from '@dockudos/core';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type AccessOptions, authorizePage } from './access.ts';
import { getSite } from './server.ts';
import { authSecret, readSession } from './session.ts';

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
  /** For `access` rules with `require: "custom"`: how to verify a visitor. */
  access?: AccessOptions;
  /** Clock, for tests. */
  now?: () => number;
  /** Where the webhook secret is read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** For the webhook; default `fetch`. */
  fetch?: typeof fetch;
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
    env = process.env,
    fetch: send = fetch,
  } = options;
  const isKnownPath =
    options.isKnownPath ??
    (async (path: string) =>
      (await getSite()).tree.pages.some((p) => p.path === path));
  const hits = new Map<string, number[]>();

  /**
   * Pass an entry on to the site's own backend (`kudos.webhook`). It gets what the store gets, and the signed-in
   * user's id only when `includeUser` is set: never an address, a cookie, a name or an email. A slow or failing
   * backend never fails the vote: the store already has it.
   */
  async function forward(request: Request, entry: KudosEntry): Promise<void> {
    // A site that cannot be loaded here (a custom `isKnownPath`, a test) has no webhook to call.
    const hook = await getSite().then(
      (site) => site.config.kudos.webhook,
      () => undefined,
    );
    if (!hook) return;
    const secret = hook.secretEnv ? env[hook.secretEnv] : undefined;
    let user: string | undefined;
    if (hook.includeUser) {
      const key = authSecret(env);
      user = key ? (await readSession(request, key))?.sub : undefined;
    }
    try {
      const res = await send(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(secret && { authorization: `Bearer ${secret}` }),
        },
        body: JSON.stringify({ ...entry, ...(user && { user }) }),
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok)
        console.error(`dockudos kudos: the webhook answered ${res.status}.`);
    } catch (error) {
      console.error(
        'dockudos kudos: the webhook failed:',
        (error as Error).message,
      );
    }
  }

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
      !path.startsWith('/')
    ) {
      return json({ error: 'unknown page' }, 400);
    }
    // Feedback on a protected page needs the same credentials as reading it. This comes before the
    // check that the page exists, so the answer does not reveal which protected pages there are.
    const denied = await authorizePage(request, path, options.access);
    if (denied) return denied;
    if (!(await isKnownPath(path))) return json({ error: 'unknown page' }, 400);
    const at = new Date(t).toISOString();

    if (vote !== undefined) {
      if (vote !== 'up' && vote !== 'down')
        return json({ error: 'vote must be "up" or "down"' }, 400);
      const entry: KudosEntry = { id: crypto.randomUUID(), at, path, vote };
      await store.add(entry);
      await forward(request, entry);
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
    const entry: KudosEntry = { id, at, path, comment: clean };
    await store.add(entry);
    await forward(request, entry);
    return json({ id }, 201);
  };
}
