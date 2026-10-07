import { parseKudosLog, type KudosEntry } from '@dockudos/core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKudosHandler, fileKudosStore } from './kudos.ts';

const post = (
  body: unknown,
  headers: Record<string, string> = {},
  raw?: string,
) =>
  new Request('http://docs.test/api/kudos', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'docs.test',
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });

function setup(extra = {}) {
  const entries: KudosEntry[] = [];
  const handler = createKudosHandler({
    store: { add: async (e) => void entries.push(e) },
    isKnownPath: (p) => p === '/guide' || p === '/',
    now: () => Date.parse('2026-02-03T04:05:06Z'),
    ...extra,
  });
  return { entries, handler };
}

describe('createKudosHandler', () => {
  it('stores a vote and returns its id', async () => {
    const { handler, entries } = setup();
    const res = await handler(post({ path: '/guide', vote: 'up' }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(entries).toEqual([
      { id, at: '2026-02-03T04:05:06.000Z', path: '/guide', vote: 'up' },
    ]);
  });

  it('stores a comment against a vote, trimmed and without control characters', async () => {
    const { handler, entries } = setup();
    const { id } = await (
      await handler(post({ path: '/guide', vote: 'down' }))
    ).json();
    const res = await handler(
      post({
        path: '/guide',
        id,
        comment: '  The step 2 is\u0000 wrong\nsee below  ',
      }),
    );
    expect(res.status).toBe(201);
    expect(entries[1]).toMatchObject({
      id,
      path: '/guide',
      comment: 'The step 2 is wrong\nsee below',
    });
  });

  it.each([
    ['an unknown page', { path: '/nope', vote: 'up' }, 'unknown page'],
    [
      'a path that is not a path',
      { path: 'guide', vote: 'up' },
      'unknown page',
    ],
    ['a missing path', { vote: 'up' }, 'unknown page'],
    ['a bad vote', { path: '/guide', vote: 'meh' }, 'vote must be'],
    [
      'a comment without an id',
      { path: '/guide', comment: 'hi' },
      'comment with its id',
    ],
    [
      'a comment with a made-up id',
      { path: '/guide', id: '1', comment: 'hi' },
      'comment with its id',
    ],
    [
      'an empty comment',
      {
        path: '/guide',
        id: '11111111-1111-1111-1111-111111111111',
        comment: '   ',
      },
      'empty',
    ],
    [
      'a long comment',
      {
        path: '/guide',
        id: '11111111-1111-1111-1111-111111111111',
        comment: 'x'.repeat(1001),
      },
      'longer than 1000',
    ],
  ])('refuses %s with 400', async (_name, body, message) => {
    const { handler, entries } = setup();
    const res = await handler(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(entries).toEqual([]);
  });

  it('refuses malformed, oversized and non-JSON requests', async () => {
    const { handler } = setup();
    expect((await handler(post(null, {}, '{nope'))).status).toBe(400);
    expect((await handler(post(null, {}, 'null'))).status).toBe(400);
    expect(
      (
        await handler(
          post(null, {}, JSON.stringify({ path: '/', pad: 'x'.repeat(9000) })),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handler(
          post({ path: '/', vote: 'up' }, { 'content-type': 'text/plain' }),
        )
      ).status,
    ).toBe(415);
  });

  it('refuses a request from another origin, and allows the same origin', async () => {
    const { handler } = setup();
    expect(
      (
        await handler(
          post({ path: '/', vote: 'up' }, { origin: 'https://evil.example' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler(
          post({ path: '/', vote: 'up' }, { origin: 'http://docs.test' }),
        )
      ).status,
    ).toBe(201);
  });

  it('rate limits per client and forgives after a minute', async () => {
    let t = 0;
    const { handler } = setup({ rateLimitPerMinute: 2, now: () => t });
    const as = (ip: string) =>
      post({ path: '/', vote: 'up' }, { 'x-forwarded-for': `${ip}, 10.0.0.1` });
    expect((await handler(as('1.1.1.1'))).status).toBe(201);
    expect((await handler(as('1.1.1.1'))).status).toBe(201);
    const limited = await handler(as('1.1.1.1'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await handler(as('2.2.2.2'))).status).toBe(201);
    t = 61_000;
    expect((await handler(as('1.1.1.1'))).status).toBe(201);
  });

  it('does not store anything that identifies the visitor', async () => {
    const { handler, entries } = setup();
    await handler(
      post(
        { path: '/', vote: 'up' },
        { 'x-forwarded-for': '9.9.9.9', 'user-agent': 'secret-agent' },
      ),
    );
    expect(JSON.stringify(entries)).not.toMatch(/9\.9\.9\.9|secret-agent/);
  });
});

describe('fileKudosStore', () => {
  it('appends one JSON line per entry, creating the folder, readable by the core', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dockudos-kudos-'));
    try {
      const file = join(dir, 'nested', 'k.jsonl');
      const store = fileKudosStore(file);
      await store.add({
        id: 'a',
        at: '2026-01-01T00:00:00Z',
        path: '/x',
        vote: 'up',
      });
      await store.add({
        id: 'a',
        at: '2026-01-01T00:00:01Z',
        path: '/x',
        comment: 'nice',
      });
      const { entries, skipped } = parseKudosLog(await readFile(file, 'utf8'));
      expect(entries).toHaveLength(2);
      expect(skipped).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
