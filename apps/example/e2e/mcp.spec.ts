import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// A real MCP client (the official SDK, the same one coding tools build on) talks to both ways of running the
// server: the /mcp route of the site, and `dockudos mcp` as a separate process.

type Text = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) => (r as Text).content[0]?.text ?? '';

async function exercise(client: Client) {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual([
    'search_docs',
    'get_page',
    'list_pages',
  ]);

  const search = await client.callTool({
    name: 'search_docs',
    arguments: { query: 'how often to rotate an API key', limit: 3 },
  });
  expect(textOf(search)).toContain('/guides/authentication#api-keys');
  expect(textOf(search)).toContain('Rotate a key every ninety days.');

  const page = await client.callTool({
    name: 'get_page',
    arguments: { path: '/guides/authentication' },
  });
  expect(textOf(page)).toContain('# Authentication');
  expect(textOf(page)).toContain('ERR_INVALID_KEY');

  const list = await client.callTool({
    name: 'list_pages',
    arguments: { query: 'billing' },
  });
  expect(textOf(list)).toContain('Billing (/guides/billing)');
  expect(textOf(list)).not.toMatch(/Secret|private/i);

  const missing = await client.callTool({
    name: 'get_page',
    arguments: { path: '/nope' },
  });
  expect((missing as Text).isError).toBe(true);
}

test.describe('MCP', () => {
  test('a client connects to the /mcp route, lists the tools and reads a page', async ({
    baseURL,
  }) => {
    const client = new Client({ name: 'e2e', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', baseURL)),
    );
    try {
      expect(client.getServerVersion()?.name).toBe(
        'Example Docs documentation',
      );
      await exercise(client);
    } finally {
      await client.close();
    }
  });

  test('a protected page needs the credentials of its rule', async ({
    baseURL,
  }) => {
    const connect = async (headers: Record<string, string> = {}) => {
      const client = new Client({ name: 'e2e', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
          requestInit: { headers },
        }),
      );
      return client;
    };
    const anonymous = await connect();
    const denied = await anonymous.callTool({
      name: 'get_page',
      arguments: { path: '/private/secret' },
    });
    expect((denied as Text).isError).toBe(true);
    expect(textOf(denied)).not.toContain('Quokka');
    // Never found by search, either.
    expect(
      textOf(
        await anonymous.callTool({
          name: 'search_docs',
          arguments: { query: 'Quokka' },
        }),
      ),
    ).toBe('No results.');
    await anonymous.close();

    const signedIn = await connect({
      authorization: `Basic ${Buffer.from('reader:s3cret-pass').toString('base64')}`,
    });
    const ok = await signedIn.callTool({
      name: 'get_page',
      arguments: { path: '/private/secret' },
    });
    expect((ok as Text).isError).toBeFalsy();
    expect(textOf(ok)).toContain('Bluefin-Quokka');
    await signedIn.close();
  });

  test('the route refuses a browser page on another origin', async ({
    request,
  }) => {
    const res = await request.post('/mcp', {
      headers: { origin: 'https://evil.example' },
      data: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(res.status()).toBe(403);
    expect((await request.get('/mcp')).status()).toBe(405);
  });

  test('`dockudos mcp` serves the same tools over standard input and output', async () => {
    const root = process.cwd();
    const client = new Client({ name: 'e2e', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: join(root, 'node_modules', '.bin', 'dockudos'),
        args: ['mcp'],
        cwd: root,
        stderr: 'pipe',
      }),
    );
    try {
      await exercise(client);
      const denied = await client.callTool({
        name: 'get_page',
        arguments: { path: '/private/secret' },
      });
      expect((denied as Text).isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
