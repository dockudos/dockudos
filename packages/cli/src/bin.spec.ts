import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The real executable, run the way a person runs it: arguments in, text and an exit code out. `run()` is covered in
 * cli.spec.ts with a fake environment; this file covers the wiring `bin.ts` adds (real stdio, real process, real files).
 */
const BIN = fileURLToPath(new URL('./bin.ts', import.meta.url));
const VERSION = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8',
    ),
  ) as { version: string }
).version;

let site: string;
let empty: string;
beforeAll(() => {
  site = mkdtempSync(join(tmpdir(), 'dkd-bin-site-'));
  empty = mkdtempSync(join(tmpdir(), 'dkd-bin-empty-'));
  mkdirSync(join(site, 'docs'), { recursive: true });
  writeFileSync(join(site, 'docs.json'), '{"name":"Bin Test"}');
  writeFileSync(
    join(site, 'docs/index.mdx'),
    '---\ntitle: Home\n---\n\n# Home\n\nThe zebra crossing is [here](/guide).\n',
  );
  writeFileSync(
    join(site, 'docs/guide.mdx'),
    '---\ntitle: Guide\n---\n\n# Guide\n\nCrossing instructions.\n',
  );
});
afterAll(() => {
  rmSync(site, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
});

const cli = (args: string[], cwd = site, input?: string) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: '1' },
  });

describe('dockudos (the executable)', () => {
  it.each([['--version'], ['-v']])(
    '%s prints the package version and exits 0',
    (flag) => {
      const r = cli([flag]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(VERSION);
    },
  );

  it.each([['--help'], ['-h'], ['help']])(
    '%s lists every command and exits 0',
    (flag) => {
      const r = cli([flag]);
      expect(r.status).toBe(0);
      for (const cmd of [
        'init',
        'dev',
        'build',
        'generate',
        'index',
        'mcp',
        'broken-links',
        'sync',
        'pdf',
        'epub',
        'kudos',
      ])
        expect(r.stdout).toContain(cmd);
    },
  );

  it('rejects an unknown command on stderr with a non-zero exit', () => {
    const r = cli(['frobnicate']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown command "frobnicate"');
    expect(r.stdout).toBe('');
  });

  it('prints help and fails when run without a command', () => {
    const r = cli([]);
    expect(`${r.stdout}${r.stderr}`).toContain('Usage: dockudos');
  });
});

describe('broken-links', () => {
  it('passes on a site whose links all resolve', () => {
    const r = cli(['broken-links']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No broken links in 2 pages.');
  });

  it('exits non-zero and names the page, the line and the link when one is broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dkd-bin-bad-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs.json'), '{"name":"Bad"}');
      writeFileSync(
        join(dir, 'docs/index.mdx'),
        '# Home\n\nSee [nowhere](/nowhere).\n',
      );
      const r = cli(['broken-links'], dir);
      expect(r.status).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain('/nowhere');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explains a missing docs.json instead of throwing a stack trace', () => {
    const r = cli(['broken-links'], empty);
    expect(r.status).not.toBe(0);
    const text = `${r.stdout}${r.stderr}`;
    expect(text).toContain('docs.json');
    expect(text).not.toMatch(/\n\s+at .*\(.*:\d+:\d+\)/);
  });
});

describe('build and index validation', () => {
  it('refuses to build a folder with no docs.json, naming the file', () => {
    const r = cli(['build', '--no-sync'], empty);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('docs.json');
  });

  it('writes a search index for the docs without building the site', () => {
    const r = cli(['index']);
    expect(r.status).toBe(0);
    const index = JSON.parse(
      readFileSync(join(site, '.dockudos/index.json'), 'utf8'),
    ) as {
      pages: { path: string }[];
    };
    expect(index.pages.map((p) => p.path).sort()).toEqual(['/', '/guide']);
  });
});

describe('kudos', () => {
  it('says where votes would be written when there is no log yet, and fails', () => {
    const r = cli(['kudos', '--json'], empty);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain('No feedback log');
  });

  it('summarises votes and comments from --file, and counts unreadable lines', () => {
    const file = join(site, 'votes.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({
          id: '1',
          path: '/guide',
          vote: 'up',
          at: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          id: '2',
          path: '/guide',
          vote: 'down',
          comment: 'Needs   an example',
          at: '2026-01-02T00:00:00Z',
        }),
        'not json',
        JSON.stringify({ id: '3', path: '/x' }),
      ].join('\n') + '\n',
    );
    const json = cli(['kudos', '--file', file, '--json']);
    expect(json.status).toBe(0);
    const summary = JSON.parse(json.stdout) as {
      up: number;
      down: number;
      skipped: number;
      pages: { path: string; up: number; down: number }[];
    };
    expect(summary).toMatchObject({ up: 1, down: 1, skipped: 2 });
    expect(summary.pages).toEqual([
      expect.objectContaining({ path: '/guide', up: 1, down: 1 }),
    ]);

    const text = cli(['kudos', '--file', file]);
    expect(text.stdout).toContain('1 helpful, 1 not helpful, on 1 pages.');
    expect(text.stdout).toContain('- Needs an example');
    expect(text.stdout).toContain(
      '2 unreadable lines in the log were skipped.',
    );
  });

  it('filters by --path and says when a page has no feedback', () => {
    const file = join(site, 'votes.jsonl');
    expect(cli(['kudos', '--file', file, '--path', '/nope']).stdout).toBe(
      'No feedback for /nope.\n',
    );
  });
});

describe('mcp over stdio', () => {
  const rpc = (id: number, method: string, params: unknown = {}) =>
    JSON.stringify({ jsonrpc: '2.0', id, method, params });

  it('answers initialize, lists the tools and searches the docs', () => {
    const r = cli(
      ['mcp'],
      site,
      [
        rpc(1, 'initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        }),
        rpc(2, 'tools/list'),
        rpc(3, 'tools/call', {
          name: 'search_docs',
          arguments: { query: 'zebra crossing' },
        }),
      ].join('\n') + '\n',
    );
    const replies = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: number; result: any });
    expect(replies.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(replies[0]!.result.serverInfo.name).toBe('Bin Test documentation');
    expect(
      replies[1]!.result.tools.map((t: { name: string }) => t.name),
    ).toEqual(expect.arrayContaining(['search_docs', 'get_page']));
    expect(JSON.stringify(replies[2]!.result)).toContain('/');
  });

  it('exits when its input closes, with nothing on stderr for a clean session', async () => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: site });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', resolve),
    );
    expect(code).toBe(0);
    expect(err).toBe('');
  });

  it('answers a malformed request with an error rather than dying', () => {
    const r = cli(
      ['mcp'],
      site,
      'this is not json\n' + rpc(7, 'tools/list') + '\n',
    );
    const lines = r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.error)).toBe(true);
    expect(lines.some((l) => l.id === 7 && l.result)).toBe(true);
  });
});
