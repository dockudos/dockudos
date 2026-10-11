import { signToken, type KudosEntry } from '@dockudos/core';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKudosHandler } from './kudos.ts';
import { SESSION_COOKIE } from './session.ts';

let root: string;
let cwd: string;
const SECRET = 'w'.repeat(40);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://docs.test/api/kudos', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'docs.test',
      ...headers,
    },
    body: JSON.stringify(body),
  });

async function site(webhook: object | undefined) {
  await writeFile(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      kudos: { enabled: true, ...(webhook && { webhook }) },
    }),
  );
}

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-hook-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'index.mdx'), '# Home');
  process.chdir(root);
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('feedback webhook', () => {
  it('posts each vote and comment to a real local endpoint, with the secret, and nothing personal', async () => {
    const received: {
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    }[] = [];
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      await site({
        url: `http://127.0.0.1:${port}/hook`,
        secretEnv: 'HOOK_SECRET',
      });
      const entries: KudosEntry[] = [];
      const handler = createKudosHandler({
        store: { add: async (e) => void entries.push(e) },
        env: { HOOK_SECRET: 'shh' },
        now: () => Date.parse('2026-02-03T04:05:06Z'),
      });
      const vote = await handler(
        post(
          { path: '/', vote: 'down' },
          { 'x-forwarded-for': '203.0.113.9', cookie: 'a=b' },
        ),
      );
      const { id } = await vote.json();
      await handler(post({ path: '/', id, comment: 'Step 2 is wrong' }));
      expect(received).toHaveLength(2);
      expect(received[0]?.body).toEqual({
        id,
        at: '2026-02-03T04:05:06.000Z',
        path: '/',
        vote: 'down',
      });
      expect(received[1]?.body).toEqual({
        id,
        at: '2026-02-03T04:05:06.000Z',
        path: '/',
        comment: 'Step 2 is wrong',
      });
      expect(received[0]?.headers['authorization']).toBe('Bearer shh');
      // no address, cookie or user travels with it
      const wire = JSON.stringify(received);
      expect(wire).not.toContain('203.0.113.9');
      expect(wire).not.toContain('a=b');
      expect(entries).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it('adds only the user id, and only when asked to', async () => {
    const seen: unknown[] = [];
    const send = (async (_u: string, init: RequestInit) => {
      seen.push(JSON.parse(init.body as string));
      return new Response('ok');
    }) as typeof fetch;
    const token = await signToken(
      { sub: 'user-9', email: 'a@x.io', name: 'Ada', roles: [], groups: [] },
      SECRET,
      { purpose: 'session', ttlSeconds: 600 },
    );
    const cookie = `${SESSION_COOKIE}=${token}`;
    const make = () =>
      createKudosHandler({
        store: { add: async () => undefined },
        env: { DOCKUDOS_AUTH_SECRET: SECRET },
        fetch: send,
      });

    await site({ url: 'https://hook.test/x' });
    await make()(post({ path: '/', vote: 'up' }, { cookie }));
    expect(seen.at(-1)).not.toHaveProperty('user');

    await site({ url: 'https://hook.test/x', includeUser: true });
    await make()(post({ path: '/', vote: 'up' }, { cookie }));
    expect(seen.at(-1)).toMatchObject({ user: 'user-9' });
    expect(JSON.stringify(seen.at(-1))).not.toMatch(/a@x\.io|Ada/);
    await make()(post({ path: '/', vote: 'up' })); // not signed in
    expect(seen.at(-1)).not.toHaveProperty('user');
  });

  it('keeps the vote when the webhook fails, is slow, or does not exist', async () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await site({ url: 'https://hook.test/x' });
    const entries: KudosEntry[] = [];
    const store = { add: async (e: KudosEntry) => void entries.push(e) };
    for (const send of [
      (async () => new Response('', { status: 500 })) as typeof fetch,
      (async () => {
        throw new Error('connection refused');
      }) as typeof fetch,
    ]) {
      const res = await createKudosHandler({ store, fetch: send })(
        post({ path: '/', vote: 'up' }),
      );
      expect(res.status).toBe(201);
    }
    expect(entries).toHaveLength(2);
    expect(errors).toHaveBeenCalledTimes(2);
    await site(undefined);
    const quiet = vi.fn();
    expect(
      (
        await createKudosHandler({ store, fetch: quiet as never })(
          post({ path: '/', vote: 'up' }),
        )
      ).status,
    ).toBe(201);
    expect(quiet).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('does not follow a redirect from the webhook', async () => {
    await site({ url: 'https://hook.test/x' });
    let init: RequestInit | undefined;
    const send = (async (_u: string, i: RequestInit) => (
      (init = i),
      new Response('ok')
    )) as typeof fetch;
    await createKudosHandler({
      store: { add: async () => undefined },
      fetch: send,
    })(post({ path: '/', vote: 'up' }));
    expect(init?.redirect).toBe('error');
  });
});
