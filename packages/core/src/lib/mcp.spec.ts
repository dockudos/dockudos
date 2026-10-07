import { buildContentIndex } from './content-index.ts';
import { KeywordSearch } from './keyword-search.ts';
import {
  type JsonRpcResponse,
  MCP_PROTOCOL_VERSIONS,
  createDocsBackend,
  createMcpServer,
  mcpParseError,
} from './mcp.ts';

const { index } = buildContentIndex([
  {
    path: '/guides/auth',
    title: 'Authentication',
    description: 'Sign in',
    body: '## API keys\n\nRotate a key every ninety days.\n\n## Errors\n\nA bad key returns 401.',
  },
  {
    path: '/guides/billing',
    title: 'Billing',
    body: '## Invoices\n\nInvoices are sent monthly.',
  },
]);
const engine = new KeywordSearch(index);

const pages = [
  { path: '/guides/auth', title: 'Authentication', description: 'Sign in' },
  { path: '/guides/billing', title: 'Billing' },
  { path: '/hidden', title: 'Hidden page' },
  { path: '/private/plan', title: 'Private plan' },
];

const backend = (allowed = false) =>
  createDocsBackend({
    search: (q, { limit }) => engine.search(q, { limit }),
    pages,
    listed: pages.slice(0, 2),
    markdown: (path) => `# ${path}\n\nBody of ${path}\n`,
    isProtected: (path) => path.startsWith('/private'),
    authorize: () => allowed,
  });

const server = (b = backend()) =>
  createMcpServer(
    { name: 'Acme docs', version: '1', instructions: 'Use search_docs.' },
    b,
  );

let n = 0;
const call = async (
  s: ReturnType<typeof server>,
  method: string,
  params?: unknown,
) =>
  (await s.handle({
    jsonrpc: '2.0',
    id: ++n,
    method,
    params,
  })) as JsonRpcResponse;
const tool = async (
  s: ReturnType<typeof server>,
  name: string,
  args?: unknown,
) =>
  (await call(s, 'tools/call', { name, arguments: args })).result as {
    content: { type: string; text: string }[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };

describe('MCP server: protocol', () => {
  it('initializes with the version the client asks for, or the newest it knows', async () => {
    const s = server();
    for (const version of MCP_PROTOCOL_VERSIONS) {
      const r = await call(s, 'initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: {},
      });
      expect(r.result).toMatchObject({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'Acme docs', version: '1' },
        instructions: 'Use search_docs.',
      });
    }
    const unknown = await call(s, 'initialize', {
      protocolVersion: '1999-01-01',
    });
    expect(
      (unknown.result as { protocolVersion: string }).protocolVersion,
    ).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it('echoes the request id, answers ping, and ignores notifications', async () => {
    const s = server();
    expect(
      await s.handle({ jsonrpc: '2.0', id: 'abc', method: 'ping' }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 'abc',
      result: {},
    });
    expect(
      await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeUndefined();
    expect(
      await s.handle({ jsonrpc: '2.0', id: 1, result: {} }),
    ).toBeUndefined();
  });

  it('lists three read-only tools with input schemas', async () => {
    const r = (await call(server(), 'tools/list')).result as {
      tools: {
        name: string;
        inputSchema: { required?: string[] };
        annotations: { readOnlyHint: boolean };
      }[];
    };
    expect(r.tools.map((t) => t.name)).toEqual([
      'search_docs',
      'get_page',
      'list_pages',
    ]);
    expect(r.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(r.tools[0]?.inputSchema.required).toEqual(['query']);
  });

  it('reports errors with the right JSON-RPC codes', async () => {
    const s = server();
    expect((await call(s, 'resources/list')).error?.code).toBe(-32601);
    expect((await call(s, 'tools/call', { name: 'nope' })).error).toMatchObject(
      { code: -32602 },
    );
    expect((await call(s, 'tools/call', {})).error?.code).toBe(-32602);
    expect(await s.handle('hello')).toMatchObject({ error: { code: -32600 } });
    expect(await s.handle({ id: 4, method: 'ping' })).toMatchObject({
      id: 4,
      error: { code: -32600 },
    });
    expect(mcpParseError().error?.code).toBe(-32700);
  });

  it('answers a batch, leaving out notifications', async () => {
    const out = await server().handle([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect((out as JsonRpcResponse[]).map((r) => r.id)).toEqual([1, 2]);
    expect(
      await server().handle([
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
    ).toBeUndefined();
    expect(await server().handle([])).toMatchObject({
      error: { code: -32600 },
    });
  });
});

describe('MCP server: tools', () => {
  it('search_docs returns matching sections with links and snippets', async () => {
    const r = await tool(server(), 'search_docs', { query: 'rotate key' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain('1. Authentication › API keys');
    expect(r.content[0]?.text).toContain('/guides/auth#api-keys');
    expect(r.content[0]?.text).toContain('Rotate a key every ninety days.');
    expect((r.structuredContent?.['results'] as unknown[])[0]).toMatchObject({
      title: 'Authentication',
      anchor: 'api-keys',
      url: '/guides/auth#api-keys',
    });
  });

  it('search_docs says so when nothing matches, and honours the limit', async () => {
    expect(
      (await tool(server(), 'search_docs', { query: 'zzzqqq' })).content[0]
        ?.text,
    ).toBe('No results.');
    const limited = await tool(server(), 'search_docs', {
      query: 'key invoices',
      limit: 1,
    });
    expect((limited.structuredContent?.['results'] as unknown[]).length).toBe(
      1,
    );
  });

  it('checks tool arguments', async () => {
    const s = server();
    const bad = async (name: string, args: unknown) =>
      (await call(s, 'tools/call', { name, arguments: args })).error;
    expect(await bad('search_docs', {})).toMatchObject({
      code: -32602,
      message: '"query" is required.',
    });
    expect(await bad('search_docs', { query: '  ' })).toMatchObject({
      code: -32602,
    });
    expect(await bad('search_docs', { query: 5 })).toMatchObject({
      message: '"query" must be text.',
    });
    expect(await bad('search_docs', { query: 'x', limit: 0 })).toMatchObject({
      code: -32602,
    });
    expect(await bad('search_docs', { query: 'x', limit: 21 })).toMatchObject({
      code: -32602,
    });
    expect(await bad('search_docs', { query: 'x'.repeat(501) })).toMatchObject({
      code: -32602,
    });
    expect(await bad('get_page', { path: 7 })).toMatchObject({ code: -32602 });
  });

  it('get_page returns the Markdown of a page, hidden ones included', async () => {
    const r = await tool(server(), 'get_page', { path: '/guides/auth' });
    expect(r.content[0]?.text).toBe('# /guides/auth\n\nBody of /guides/auth\n');
    expect(r.structuredContent).toMatchObject({
      path: '/guides/auth',
      title: 'Authentication',
    });
    expect(
      (await tool(server(), 'get_page', { path: '/hidden' })).isError,
    ).toBeUndefined();
  });

  it('get_page reports a missing page as a tool error that says what to do', async () => {
    const r = await tool(server(), 'get_page', { path: '/nope' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('list_pages');
  });

  it('get_page needs credentials for a protected page, and reads it once they are shown', async () => {
    const denied = await tool(server(backend(false)), 'get_page', {
      path: '/private/plan',
    });
    expect(denied).toMatchObject({ isError: true });
    expect(denied.content[0]?.text).toContain('credentials');
    expect(denied.content[0]?.text).not.toContain('Body of');
    const allowed = await tool(server(backend(true)), 'get_page', {
      path: '/private/plan',
    });
    expect(allowed.isError).toBeUndefined();
    expect(allowed.content[0]?.text).toContain('Body of /private/plan');
  });

  it('list_pages lists public pages only, filtered and limited', async () => {
    const all = await tool(server(), 'list_pages');
    expect(all.content[0]?.text).toBe(
      '- Authentication (/guides/auth): Sign in\n- Billing (/guides/billing)',
    );
    expect(all.structuredContent).toMatchObject({ total: 2 });
    expect(JSON.stringify(all)).not.toMatch(/Hidden|Private/);
    const some = await tool(server(), 'list_pages', { query: 'bill' });
    expect(some.content[0]?.text).toContain('Billing');
    expect(some.content[0]?.text).not.toContain('Authentication');
    expect(
      (await tool(server(), 'list_pages', { query: 'zzz' })).content[0]?.text,
    ).toBe('No pages.');
  });

  it('turns an unexpected failure into a generic internal error', async () => {
    const broken = createMcpServer(
      { name: 'x', version: '1' },
      {
        search: () => {
          throw new Error('disk on fire /secret/path');
        },
        getPage: () => undefined,
        listPages: () => [],
      },
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await call(broken, 'tools/call', {
      name: 'search_docs',
      arguments: { query: 'x' },
    });
    spy.mockRestore();
    expect(r.error).toEqual({
      code: -32603,
      message: 'The documentation server failed.',
    });
  });
});
