import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from './io.ts';
import { buildEnv, parseDotenv } from './index-site.ts';
import { run } from './run.ts';

let dir: string;
let server: Server;
let baseUrl: string;
let requests: { key: string | undefined; inputs: string[] }[];
let status = 200;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-index-'));
  requests = [];
  status = 200;
  // A stand-in for an OpenAI-compatible /embeddings route.
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { input } = JSON.parse(body) as { input: string[] };
      requests.push({ key: req.headers.authorization, inputs: input });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        status === 200
          ? JSON.stringify({
              data: input.map((_, index) => ({
                index,
                embedding: [index + 1, 0.5, 0.25],
              })),
            })
          : '{"error":{"message":"quota exceeded"}}',
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

function makeEnv(vars: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const env = {
    cwd: dir,
    vars,
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
  } as unknown as Env;
  return { env, text: () => out.join(''), errText: () => err.join('') };
}

async function site(extra: object = {}, files: Record<string, string> = {}) {
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(
    join(dir, 'docs.json'),
    JSON.stringify({
      name: 'T',
      ai: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-x',
        embeddings: { model: 'test-embed', baseUrl },
        ...extra,
      },
    }),
  );
  await writeFile(join(dir, 'docs', 'index.mdx'), '# Home\n\nWelcome home.');
  await writeFile(join(dir, 'docs', 'a.mdx'), '# A\n\nAlpha text.');
  for (const [file, text] of Object.entries(files))
    await writeFile(join(dir, file), text);
}

const readIndex = async () =>
  JSON.parse(await readFile(join(dir, '.dockudos', 'index.json'), 'utf8')) as {
    chunks: { vector?: number[] }[];
    embeddings?: { provider: string; model: string; dimensions: number };
  };

describe('dockudos index', () => {
  it('builds the index with vectors and reuses them next time', async () => {
    await site();
    const first = makeEnv({ DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1' });
    expect(await run(['index'], first.env)).toBe(0);
    expect(first.text()).toContain('Indexed 2 pages into 2 chunks (0 reused).');
    expect(first.text()).toContain('Embedded 2 chunks (0 reused).');
    const index = await readIndex();
    expect(index.embeddings).toEqual({
      provider: 'openai',
      model: 'test-embed',
      dimensions: 3,
    });
    expect(index.chunks.every((c) => c.vector?.length === 3)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.key).toBe('Bearer sk-embed-secret-1');
    expect(requests[0]?.inputs[0]).toContain('Home\n\nWelcome home.');

    await writeFile(join(dir, 'docs', 'a.mdx'), '# A\n\nAlpha text changed.');
    const second = makeEnv({
      DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1',
    });
    expect(await run(['index'], second.env)).toBe(0);
    expect(second.text()).toContain('Embedded 1 chunk (1 reused).');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputs).toHaveLength(1);
    expect((await readIndex()).chunks.every((c) => c.vector)).toBe(true);
  });

  it('does not call the provider when nothing changed', async () => {
    await site();
    const vars = { DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1' };
    await run(['index'], makeEnv(vars).env);
    const again = makeEnv(vars);
    await run(['index'], again.env);
    expect(again.text()).toContain('Embedded 0 chunks (2 reused).');
    expect(requests).toHaveLength(1);
  });

  it('says which variable is missing and still writes a keyword index', async () => {
    await site();
    const t = makeEnv();
    expect(await run(['index'], t.env)).toBe(0);
    expect(t.errText()).toContain('Embeddings skipped.');
    expect(t.errText()).toContain('DOCKUDOS_EMBEDDINGS_API_KEY');
    expect(requests).toHaveLength(0);
    expect((await readIndex()).chunks.some((c) => c.vector)).toBe(false);
  });

  it('reports a provider failure without failing, and never prints the key', async () => {
    await site();
    status = 429;
    const t = makeEnv({ DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1' });
    expect(await run(['index'], t.env)).toBe(0);
    expect(t.errText()).toContain('Embeddings skipped.');
    expect(t.errText()).toContain('quota exceeded');
    expect(t.errText() + t.text()).not.toContain('sk-embed-secret-1');
    expect((await readIndex()).chunks.some((c) => c.vector)).toBe(false);
  }, 20_000);

  it('reads the key from .env.local, which the real environment overrides', async () => {
    await site(
      {},
      {
        '.env.local':
          'DOCKUDOS_EMBEDDINGS_API_KEY="sk-from-file-123"\nOTHER=1\n',
      },
    );
    await run(['index'], makeEnv().env);
    expect(requests[0]?.key).toBe('Bearer sk-from-file-123');
    requests = [];
    await writeFile(join(dir, 'docs', 'a.mdx'), '# A\n\nAnother change.');
    await run(
      ['index'],
      makeEnv({ DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-from-shell-456' }).env,
    );
    expect(requests[0]?.key).toBe('Bearer sk-from-shell-456');
  });

  it('does nothing about embeddings when AI is off or embeddings are not configured', async () => {
    await site({ enabled: false });
    const off = makeEnv({ DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1' });
    await run(['index'], off.env);
    expect(off.text()).not.toContain('Embedded');
    await site({ embeddings: undefined });
    await run(
      ['index'],
      makeEnv({ DOCKUDOS_EMBEDDINGS_API_KEY: 'sk-embed-secret-1' }).env,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('parseDotenv / buildEnv', () => {
  it('reads plain, quoted, exported and commented values', () => {
    expect(
      parseDotenv(
        [
          '# comment',
          'A=1',
          'export B="two words"',
          "C='single'",
          'D=value # trailing',
          'bad line',
          'E=',
        ].join('\n'),
      ),
    ).toEqual({ A: '1', B: 'two words', C: 'single', D: 'value', E: '' });
  });

  it('only takes DOCKUDOS_ variables and never overrides the environment', async () => {
    await writeFile(
      join(dir, '.env'),
      'DOCKUDOS_LLM_API_KEY=file\nDOCKUDOS_X=file\nDATABASE_URL=secret',
    );
    await writeFile(join(dir, '.env.local'), 'DOCKUDOS_X=local');
    const merged = await buildEnv(dir, { DOCKUDOS_LLM_API_KEY: 'shell' });
    expect(merged['DOCKUDOS_LLM_API_KEY']).toBe('shell');
    expect(merged['DOCKUDOS_X']).toBe('local');
    expect(merged['DATABASE_URL']).toBeUndefined();
  });
});
