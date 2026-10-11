import {
  hostMatcher,
  isPrivateAddress,
  createPlaygroundHandler,
} from './playground-proxy.ts';

const config = vi.hoisted(() => ({
  proxy: true,
  allowedHosts: [] as string[],
  root: '/nonexistent',
}));
vi.mock('./server.ts', () => ({
  getSite: async () => ({
    root: config.root,
    config: { openapi: { playground: config } },
  }),
}));

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
    '224.0.0.1',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111'])(
    '%s is public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('hostMatcher', () => {
  it('matches the host of a server and lets a variable stand for one label', () => {
    expect(hostMatcher('https://api.test/v1')?.('api.test')).toBe(true);
    expect(hostMatcher('https://api.test/v1')?.('evil.test')).toBe(false);
    expect(hostMatcher('https://api.test/v1')?.('api.test.evil.com')).toBe(
      false,
    );
    const regional = hostMatcher('https://{region}.api.test');
    expect(regional?.('eu.api.test')).toBe(true);
    expect(regional?.('a.b.api.test')).toBe(false);
    expect(regional?.('api.test')).toBe(false);
  });
  it('allows nothing for a server that is only a variable', () => {
    expect(hostMatcher('{server}/v1')).toBeUndefined();
    expect(hostMatcher('https://{host}')).toBeUndefined();
  });
});

describe('playground proxy', () => {
  const upstream = vi.fn(
    async (_url: URL | string, _init?: RequestInit) =>
      new Response('{"ok":true}', {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
      }),
  );
  const lookup = vi.fn(async (_host: string) => [{ address: '93.184.216.34' }]);
  const call = (body: unknown, headers: Record<string, string> = {}) =>
    createPlaygroundHandler({
      fetch: upstream as unknown as typeof fetch,
      lookup,
    })(
      new Request('http://docs.test/api/playground', {
        method: 'POST',
        headers: {
          host: 'docs.test',
          'x-dockudos-playground': '1',
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  const ask = {
    method: 'GET',
    url: 'http://127.0.0.1:4398/x',
    headers: [] as [string, string][],
  };

  beforeEach(() => {
    config.proxy = true;
    config.allowedHosts = ['127.0.0.1:4398', 'api.allowed.test'];
    upstream.mockClear();
    lookup.mockClear();
  });

  it('is off unless docs.json turns it on', async () => {
    config.proxy = false;
    expect((await call(ask)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('only answers the site itself', async () => {
    expect((await call(ask, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await call(ask, { 'x-dockudos-playground': '' })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect((await call(ask, { origin: 'http://docs.test' })).status).toBe(200);
  });

  it('forwards to an allowed host and returns status, headers and body', async () => {
    const response = await call({
      ...ask,
      method: 'POST',
      body: '{"a":1}',
      headers: [
        ['Authorization', 'Bearer t'],
        ['Cookie', 'sid=1'],
        ['Host', 'evil'],
      ],
    });
    expect(await response.json()).toMatchObject({
      status: 201,
      statusText: 'Created',
      body: '{"ok":true}',
      encoding: 'utf8',
    });
    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:4398/x');
    const sent = init.headers as Headers;
    expect(sent.get('authorization')).toBe('Bearer t');
    expect(sent.get('cookie')).toBeNull();
    expect(sent.get('host')).toBeNull();
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe('{"a":1}');
  });

  it('refuses hosts that are not listed', async () => {
    const response = await call({ ...ask, url: 'https://elsewhere.test/x' });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('allowedHosts');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses other protocols, credentials in the URL and bad input', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://api.allowed.test/',
      'http://u:p@api.allowed.test/',
    ]) {
      expect((await call({ ...ask, url })).status, url).toBe(400);
    }
    expect((await call('not json')).status).toBe(400);
    expect((await call({ ...ask, method: 'get' })).status).toBe(400);
    expect((await call({ ...ask, headers: [['bad name', 'x']] })).status).toBe(
      400,
    );
    expect(
      (await call({ ...ask, headers: [['X', 'a\r\nInjected: 1']] })).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('does not let a name from the spec lead into a private network', async () => {
    config.allowedHosts = [];
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    config.root = await mkdtemp(join(tmpdir(), 'proxy-'));
    await mkdir(join(config.root, '.dockudos/api/s'), { recursive: true });
    await writeFile(
      join(config.root, '.dockudos/api/s/servers.json'),
      '["https://api.spec.test/v1"]',
    );
    const send = (addresses: string[]) =>
      createPlaygroundHandler({
        fetch: upstream as unknown as typeof fetch,
        lookup: async () => addresses.map((address) => ({ address })),
      })(
        new Request('http://docs.test/api/playground', {
          method: 'POST',
          headers: { host: 'docs.test', 'x-dockudos-playground': '1' },
          body: JSON.stringify({ ...ask, url: 'https://api.spec.test/v1/x' }),
        }),
      );
    const internal = await send(['93.184.216.34', '10.0.0.5']);
    expect(internal.status).toBe(403);
    expect((await internal.json()).error).toContain('private network');
    expect(upstream).not.toHaveBeenCalled();
    expect((await send(['93.184.216.34'])).status).toBe(200);
    await rm(config.root, { recursive: true });
    config.root = '/nonexistent';
  });

  it('rejects payloads that are not shaped right', async () => {
    for (const body of [
      'null',
      '"text"',
      JSON.stringify({ ...ask, url: 3 }),
      JSON.stringify({ ...ask, headers: 'x' }),
      JSON.stringify({ ...ask, headers: [['only-one']] }),
      JSON.stringify({ ...ask, headers: [[1, 2]] }),
      JSON.stringify({ ...ask, body: 5 }),
      JSON.stringify({ ...ask, url: 'not a url' }),
    ])
      expect((await call(body)).status, body).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a request that is too large', async () => {
    const response = await call({ ...ask, body: 'x'.repeat(2_100_000) });
    expect(response.status).toBe(413);
  });

  it('slows down a client that asks too often', async () => {
    const handler = createPlaygroundHandler({
      fetch: upstream as unknown as typeof fetch,
      lookup,
    });
    const send = () =>
      handler(
        new Request('http://docs.test/api/playground', {
          method: 'POST',
          headers: {
            host: 'docs.test',
            'x-dockudos-playground': '1',
            'x-forwarded-for': '9.9.9.9',
          },
          body: JSON.stringify(ask),
        }),
      );
    let last = 200;
    let response: Response | undefined;
    for (let i = 0; i < 40 && last !== 429; i++) {
      response = await send();
      last = response.status;
    }
    expect(last).toBe(429);
    expect(response!.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  describe('for a server named in the spec', () => {
    let root: string;
    beforeEach(async () => {
      const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      root = await mkdtemp(join(tmpdir(), 'proxy-'));
      await mkdir(join(root, '.dockudos/api/s'), { recursive: true });
      await writeFile(
        join(root, '.dockudos/api/s/servers.json'),
        JSON.stringify(['https://api.spec.test/v1', 'http://10.1.2.3:8080']),
      );
      config.root = root;
      config.allowedHosts = [];
    });
    afterEach(async () => {
      const { rm } = await import('node:fs/promises');
      await rm(root, { recursive: true });
      config.root = '/nonexistent';
    });
    const send = (url: string, resolve: () => Promise<{ address: string }[]>) =>
      createPlaygroundHandler({
        fetch: upstream as unknown as typeof fetch,
        lookup: resolve,
      })(
        new Request('http://docs.test/api/playground', {
          method: 'POST',
          headers: { host: 'docs.test', 'x-dockudos-playground': '1' },
          body: JSON.stringify({ ...ask, url }),
        }),
      );

    it('says so when the name cannot be found', async () => {
      const response = await send('https://api.spec.test/v1/x', async () => {
        throw new Error('ENOTFOUND');
      });
      expect(response.status).toBe(502);
      expect((await response.json()).error).toContain('could not be found');
    });

    it('checks an address written as an IP literal without asking DNS', async () => {
      const resolve = vi.fn(async () => [{ address: '93.184.216.34' }]);
      const response = await send('http://10.1.2.3:8080/x', resolve);
      expect(response.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it('refuses an answer that is too large, and passes on one with no body', async () => {
    const big = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 12; i++) controller.enqueue(big);
        controller.close();
      },
    });
    upstream.mockResolvedValueOnce(new Response(stream));
    expect((await call(ask)).status).toBe(502);
    upstream.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const empty = await call(ask);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ status: 204, body: '' });
  });

  it('ignores a servers list that is not valid JSON', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    config.root = await mkdtemp(join(tmpdir(), 'proxy-'));
    await mkdir(join(config.root, '.dockudos/api/s'), { recursive: true });
    await writeFile(join(config.root, '.dockudos/api/s/servers.json'), '{nope');
    config.allowedHosts = [];
    expect((await call({ ...ask, url: 'https://x.test/' })).status).toBe(403);
    await rm(config.root, { recursive: true });
    config.root = '/nonexistent';
  });

  it('reports an upstream that cannot be reached', async () => {
    upstream.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const response = await call(ask);
    expect(response.status).toBe(504);
    expect((await response.json()).error).toContain('ECONNREFUSED');
  });
});
