import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from './io.ts';
import { run } from './run.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-mcp-cli-'));
  await mkdir(join(dir, 'docs', 'private'), { recursive: true });
  await writeFile(
    join(dir, 'docs.json'),
    JSON.stringify({
      name: 'T',
      access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
    }),
  );
  await writeFile(
    join(dir, 'docs', 'index.mdx'),
    '---\ntitle: Home\n---\n\nRotate a key every ninety days.\n',
  );
  await writeFile(
    join(dir, 'docs', 'private', 'plan.mdx'),
    '---\ntitle: Plan\n---\n\nSecret plan.\n',
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function session(lines: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const env = {
    cwd: dir,
    vars: {},
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
    stdinLines: async function* () {
      yield* lines;
    },
  } as unknown as Env;
  const code = await run(['mcp'], env);
  return {
    code,
    replies: out
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
    err: err.join(''),
  };
}

const req = (id: number, method: string, params?: object) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params });

describe('dockudos mcp', () => {
  it('answers a whole session on standard input and output, one JSON message per line', async () => {
    const { code, replies } = await session([
      req(1, 'initialize', { protocolVersion: '2025-06-18' }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      req(2, 'tools/list'),
      req(3, 'tools/call', {
        name: 'search_docs',
        arguments: { query: 'rotate key' },
      }),
      req(4, 'tools/call', { name: 'get_page', arguments: { path: '/' } }),
      req(5, 'tools/call', { name: 'list_pages', arguments: {} }),
    ]);
    expect(code).toBe(0);
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(replies[0].result.serverInfo.name).toBe('T documentation');
    expect(replies[1].result.tools).toHaveLength(3);
    expect(replies[2].result.content[0].text).toContain(
      'Rotate a key every ninety days.',
    );
    expect(replies[3].result.content[0].text).toContain('# Home');
    expect(replies[4].result.content[0].text).toBe('- Home (/)');
  });

  it('prints nothing else on standard output, and survives a bad line and blank lines', async () => {
    const { replies, err } = await session(['', '{broken', req(1, 'ping')]);
    expect(replies).toHaveLength(2);
    expect(replies[0].error.code).toBe(-32700);
    expect(replies[1]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(err).toBe('');
  });

  it('does not read protected pages: there is nobody to show credentials', async () => {
    const { replies } = await session([
      req(1, 'tools/call', {
        name: 'get_page',
        arguments: { path: '/private/plan' },
      }),
    ]);
    expect(replies[0].result.isError).toBe(true);
    expect(JSON.stringify(replies)).not.toContain('Secret plan');
  });

  it('fails with the problem on standard error when the project is not valid', async () => {
    await writeFile(join(dir, 'docs.json'), '{"nope":1}');
    const out: string[] = [];
    const err: string[] = [];
    const env = {
      cwd: dir,
      vars: {},
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
      stdinLines: async function* () {
        /* none */
      },
    } as unknown as Env;
    expect(await run(['mcp'], env)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('name');
  });
});
