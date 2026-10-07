import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpHandler } from './mcp.ts';

let root: string;
let cwd: string;

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://docs.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'docs.test',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const basic = (u: string, p: string) => `Basic ${btoa(`${u}:${p}`)}`;

let id = 0;
async function tool(
  handler: ReturnType<typeof createMcpHandler>,
  name: string,
  args: object,
  headers: Record<string, string> = {},
) {
  const res = await handler.POST(
    rpc(
      {
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      headers,
    ),
  );
  return (await res.json()).result as {
    content: { text: string }[];
    isError?: boolean;
  };
}

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-mcp-'));
  await mkdir(join(root, 'docs', 'private'), { recursive: true });
  await writeFile(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      access: { rules: [{ paths: ['/private/**'], require: 'basic' }] },
    }),
  );
  await writeFile(
    join(root, 'docs', 'index.mdx'),
    '---\ntitle: Home\n---\n\nRotate a key every ninety days.\n',
  );
  await writeFile(
    join(root, 'docs', 'hidden.mdx'),
    '---\ntitle: Hidden\nhidden: true\n---\n\nQuietly routable.\n',
  );
  await writeFile(
    join(root, 'docs', 'private', 'plan.mdx'),
    '---\ntitle: Plan\n---\n\nBluefin roadmap.\n',
  );
  process.chdir(root);
});
afterEach(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('MCP route', () => {
  const access = { env: { DOCKUDOS_BASIC_AUTH: 'ada:lovelace' } };

  it('speaks the protocol over POST: initialize, initialized, tools/list', async () => {
    const h = createMcpHandler();
    const init = await h.POST(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    );
    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toContain('application/json');
    expect((await init.json()).result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'Acme documentation' },
    });
    const note = await h.POST(
      rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(note.status).toBe(202);
    const list = await (
      await h.POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    ).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'search_docs',
      'get_page',
      'list_pages',
    ]);
  });

  it('searches, reads and lists the public docs; hidden and protected pages are not listed or found', async () => {
    const h = createMcpHandler({ access });
    const found = await tool(h, 'search_docs', { query: 'rotate a key' });
    expect(found.content[0]?.text).toContain('Home');
    expect(
      (await tool(h, 'search_docs', { query: 'Bluefin roadmap Quietly' }))
        .content[0]?.text,
    ).toBe('No results.');
    const listed = await tool(h, 'list_pages', {});
    expect(listed.content[0]?.text).toBe('- Home (/)');
    const page = await tool(h, 'get_page', { path: '/' });
    expect(page.content[0]?.text).toContain('# Home');
    expect(
      (await tool(h, 'get_page', { path: '/hidden' })).content[0]?.text,
    ).toContain('Quietly routable.');
  });

  it('shows a protected page only with the credentials its rule asks for', async () => {
    const h = createMcpHandler({ access });
    const refused = await tool(h, 'get_page', { path: '/private/plan' });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).not.toContain('Bluefin');
    const wrong = await tool(
      h,
      'get_page',
      { path: '/private/plan' },
      { authorization: basic('ada', 'nope') },
    );
    expect(wrong.isError).toBe(true);
    const ok = await tool(
      h,
      'get_page',
      { path: '/private/plan' },
      { authorization: basic('ada', 'lovelace') },
    );
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]?.text).toContain('Bluefin roadmap.');
  });

  it('refuses browser requests from other origins, allows the site and listed origins, and calls without Origin', async () => {
    const h = createMcpHandler({ allowedOrigins: ['https://app.example.com'] });
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const evil = await h.POST(rpc(ping, { origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    expect((await h.POST(rpc(ping, { origin: 'not a url' }))).status).toBe(403);
    expect(
      (await h.POST(rpc(ping, { origin: 'http://docs.test' }))).status,
    ).toBe(200);
    expect(
      (await h.POST(rpc(ping, { origin: 'https://app.example.com' }))).status,
    ).toBe(200);
    expect((await h.POST(rpc(ping))).status).toBe(200);
  });

  it('rejects malformed JSON with a JSON-RPC parse error, and oversized bodies', async () => {
    const h = createMcpHandler();
    const bad = await h.POST(rpc('{nope'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
    const big = await h.POST(
      rpc({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70_000) }),
    );
    expect(big.status).toBe(413);
  });

  it('limits requests per visitor', async () => {
    const h = createMcpHandler({ ratePerMinute: 2 });
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const as = (ip: string) => h.POST(rpc(ping, { 'x-forwarded-for': ip }));
    expect((await as('1.1.1.1')).status).toBe(200);
    expect((await as('1.1.1.1')).status).toBe(200);
    const limited = await as('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await as('2.2.2.2')).status).toBe(200);
  });

  it('only accepts POST', async () => {
    const h = createMcpHandler();
    const get = await h.GET();
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await h.DELETE()).status).toBe(405);
  });
});
