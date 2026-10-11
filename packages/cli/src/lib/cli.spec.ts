import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinks, discoverPages, loadConfig } from '@dockudos/core/node';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { findChrome } from './chrome.ts';
import { type Env } from './io.ts';
import { run } from './run.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-cli-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

class FakeChild extends EventEmitter {
  killed: string | undefined;
  kill(signal: string) {
    this.killed = signal;
    // A killed dev server exits with a signal, which `exitCode` reports as 1.
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
}

function makeEnv(overrides: Partial<Env> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const children: { args: string[]; child: FakeChild }[] = [];
  const watchers: (() => void)[] = [];
  const env: Env = {
    cwd: dir,
    vars: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    interactive: false,
    ask: async (_q, fallback) => fallback,
    spawn: ((_cmd: string, args: string[]) => {
      const child = new FakeChild();
      children.push({ args, child });
      return child as unknown as ChildProcess;
    }) as Env['spawn'],
    watch: (_path, onChange) => {
      watchers.push(onChange);
      return { close: () => undefined };
    },
    freePort: async () => 4555,
    fetch: async () => ({ status: 200 }),
    stdinLines: async function* () {
      /* no input */
    },
    renderPdf: async () => new TextEncoder().encode('%PDF-fake'),
    ...overrides,
  };
  return {
    env,
    out,
    err,
    children,
    watchers,
    text: () => out.join(''),
    errText: () => err.join(''),
  };
}

async function project(files: Record<string, string>) {
  await writeFile(join(dir, 'package.json'), '{"name":"p"}');
  await mkdir(join(dir, 'node_modules', 'next', 'dist', 'bin'), {
    recursive: true,
  });
  await writeFile(
    join(dir, 'node_modules', 'next', 'package.json'),
    '{"name":"next"}',
  );
  await writeFile(join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'), '');
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), text);
  }
}

const GOOD = {
  'docs.json': '{"name":"T"}',
  'docs/index.mdx': '# Home\n\n[x](./a.mdx)',
  'docs/a.mdx': '# A',
};

describe('run', () => {
  it('prints help, and exits 1 when no command is given', async () => {
    const a = makeEnv();
    expect(await run([], a.env)).toBe(1);
    expect(a.text()).toContain('Usage: dockudos');
    const b = makeEnv();
    expect(await run(['--help'], b.env)).toBe(0);
  });

  it('prints the version', async () => {
    const t = makeEnv();
    expect(await run(['--version'], t.env, '1.2.3')).toBe(0);
    expect(t.text()).toBe('1.2.3\n');
  });

  it('rejects an unknown command', async () => {
    const t = makeEnv();
    expect(await run(['frobnicate'], t.env)).toBe(1);
    expect(t.errText()).toContain('Unknown command "frobnicate"');
  });

  it('reports a bad flag as a plain message', async () => {
    const t = makeEnv();
    expect(await run(['broken-links', '--nope'], t.env)).toBe(1);
    expect(t.errText()).toMatch(/nope/);
  });
});

describe('init', () => {
  it('scaffolds a site with the site name, slug and install commands filled in', async () => {
    const t = makeEnv({
      vars: { npm_config_user_agent: 'pnpm/10.0.0 node/v22' },
    });
    expect(await run(['init', 'my-docs', '--name', 'Acme Docs'], t.env)).toBe(
      0,
    );
    const root = join(dir, 'my-docs');

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-docs');
    expect(pkg.dependencies['@dockudos/next']).toMatch(/^(\^|0\.0\.)/);
    expect(pkg.scripts.dev).toBe('dockudos dev');
    expect(
      JSON.parse(await readFile(join(root, 'docs.json'), 'utf8')).name,
    ).toBe('Acme Docs');
    expect(await readFile(join(root, 'README.md'), 'utf8')).toContain(
      'pnpm install',
    );
    expect(await readFile(join(root, 'docs/index.mdx'), 'utf8')).toContain(
      'title: Welcome to Acme Docs',
    );
    expect(t.text()).toContain('cd my-docs');
    expect(t.text()).toContain('pnpm install');
  });

  it('renames the shipped placeholders and leaves no template tokens behind', async () => {
    const t = makeEnv();
    await run(['init', 'site', '--yes'], t.env);
    const root = join(dir, 'site');
    expect((await stat(join(root, '.gitignore'))).isFile()).toBe(true);
    const all = (await readdir(root, { recursive: true })).filter(
      (f) => !f.startsWith('node_modules'),
    );
    expect(
      all.some((f) => f.endsWith('.tpl') || f.endsWith('_gitignore')),
    ).toBe(false);
    for (const file of all) {
      const full = join(root, file);
      if ((await stat(full)).isFile())
        expect(await readFile(full, 'utf8')).not.toMatch(/\{\{\w+\}\}/);
    }
    expect((await stat(join(root, 'next.config.mjs'))).isFile()).toBe(true);
  });

  it('produces a site that validates and has no broken links', async () => {
    const t = makeEnv();
    await run(['init', 'site', '--yes'], t.env);
    const root = join(dir, 'site');
    const config = await loadConfig(root);
    const tree = await discoverPages(join(root, 'docs'));
    expect(config.navigation.length).toBeGreaterThan(0);
    expect(
      await checkLinks({
        docsDir: join(root, 'docs'),
        publicDir: join(root, 'public'),
        tree,
      }),
    ).toEqual([]);
  });

  it('refuses a folder that is not empty and leaves it untouched', async () => {
    await mkdir(join(dir, 'taken'));
    await writeFile(join(dir, 'taken', 'keep.txt'), 'x');
    const t = makeEnv();
    expect(await run(['init', 'taken', '--yes'], t.env)).toBe(1);
    expect(t.errText()).toContain('is not empty');
    expect(await readdir(join(dir, 'taken'))).toEqual(['keep.txt']);
  });

  it('accepts an existing empty folder or one holding only .git', async () => {
    await mkdir(join(dir, 'empty', '.git'), { recursive: true });
    const t = makeEnv();
    expect(await run(['init', 'empty', '--yes'], t.env)).toBe(0);
  });

  it('rejects an unknown package manager', async () => {
    const t = makeEnv();
    expect(await run(['init', 'x', '--package-manager', 'cargo'], t.env)).toBe(
      1,
    );
    expect(t.errText()).toContain('Unknown package manager "cargo"');
  });

  it('asks for the folder, site name and package manager when interactive', async () => {
    const answers: Record<string, string> = {
      'Project folder': 'asked',
      'Site name': 'Asked Docs',
      'Package manager': 'yarn',
    };
    const t = makeEnv({
      interactive: true,
      ask: async (q, fallback) =>
        answers[Object.keys(answers).find((k) => q.startsWith(k)) ?? ''] ??
        fallback,
    });
    expect(await run(['init'], t.env)).toBe(0);
    expect(
      JSON.parse(await readFile(join(dir, 'asked', 'docs.json'), 'utf8')).name,
    ).toBe('Asked Docs');
    expect(await readFile(join(dir, 'asked', 'README.md'), 'utf8')).toContain(
      'yarn install',
    );
  });

  it('does not ask anything with --yes', async () => {
    const ask = vi.fn();
    const t = makeEnv({ interactive: true, ask });
    expect(await run(['init', 'q', '--yes'], t.env)).toBe(0);
    expect(ask).not.toHaveBeenCalled();
  });

  it('keeps quotes out of the site name so docs.json stays valid JSON', async () => {
    const t = makeEnv();
    await run(['init', 'q', '--name', 'Say "hi"'], t.env);
    expect(() =>
      JSON.parse(readFileSync(join(dir, 'q', 'docs.json'), 'utf8')),
    ).not.toThrow();
  });
});

describe('broken-links', () => {
  it('passes a healthy site', async () => {
    await project(GOOD);
    const t = makeEnv();
    expect(await run(['broken-links'], t.env)).toBe(0);
    expect(t.text()).toContain('No broken links in 2 pages');
  });

  it('fails with file, line and the problem', async () => {
    await project({
      ...GOOD,
      'docs/index.mdx': 'one\n\n[gone](./nope.mdx) [bad](./a.mdx#nowhere)',
    });
    const t = makeEnv();
    expect(await run(['broken-links'], t.env)).toBe(1);
    expect(t.errText()).toContain('index.mdx:3');
    expect(t.errText()).toContain('no page at /nope');
    expect(t.errText()).toContain('/a has no heading with id "nowhere"');
    expect(t.errText()).toContain('2 broken links');
  });

  it('fails clearly on an invalid docs.json before checking links', async () => {
    await project({ ...GOOD, 'docs.json': '{"navigation":[]}' });
    const t = makeEnv();
    expect(await run(['broken-links'], t.env)).toBe(1);
    expect(t.errText()).toContain('name:');
  });
});

describe('build', () => {
  it('stops with the key name on a bad docs.json and never starts next', async () => {
    await project({
      ...GOOD,
      'docs.json': '{"name":"T","theme":{"layout":"wide"}}',
    });
    const t = makeEnv();
    expect(await run(['build'], t.env)).toBe(1);
    expect(t.errText()).toContain('theme.layout');
    expect(t.children).toHaveLength(0);
  });

  it('stops on a navigation entry that does not exist', async () => {
    await project({
      ...GOOD,
      'docs.json':
        '{"name":"T","navigation":[{"tab":"A","groups":[{"group":"G","pages":["missing"]}]}]}',
    });
    const t = makeEnv();
    expect(await run(['build'], t.env)).toBe(1);
    expect(t.errText()).toContain('page "missing" not found');
  });

  it('stops on broken links, naming them', async () => {
    await project({ ...GOOD, 'docs/a.mdx': '[x](/missing)' });
    const t = makeEnv();
    expect(await run(['build'], t.env)).toBe(1);
    expect(t.errText()).toContain('a.mdx:1');
    expect(t.children).toHaveLength(0);
  });

  it("runs next build with the project's own next and passes extra arguments through", async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['build', '--debug'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    expect(t.children[0]!.args.slice(1)).toEqual(['build', '--debug']);
    expect(t.children[0]!.args[0]).toMatch(
      /node_modules\/next\/dist\/bin\/next$/,
    );
    t.children[0]!.child.emit('exit', 0);
    expect(await done).toBe(0);
  });

  it('writes the content index before building, reusing unchanged pages next time', async () => {
    await project(GOOD);
    const first = makeEnv();
    const done = run(['build'], first.env);
    await vi.waitFor(() => expect(first.children).toHaveLength(1));
    first.children[0]!.child.emit('exit', 0);
    await done;
    expect(first.text()).toContain('Indexed 2 pages into 1 chunk (0 reused).');
    const index = JSON.parse(
      await readFile(join(dir, '.dockudos', 'index.json'), 'utf8'),
    );
    expect(index.pages.map((p: { path: string }) => p.path)).toEqual([
      '/',
      '/a',
    ]);

    await writeFile(join(dir, 'docs', 'a.mdx'), '# A\n\nChanged.');
    const second = makeEnv();
    const again = run(['build'], second.env);
    await vi.waitFor(() => expect(second.children).toHaveLength(1));
    second.children[0]!.child.emit('exit', 0);
    await again;
    expect(second.text()).toContain('(1 reused)');
  });

  it('returns the exit code of next build', async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['build'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    t.children[0]!.child.emit('exit', 3);
    expect(await done).toBe(3);
  });

  describe('--static', () => {
    const exists = (file: string) =>
      readFile(join(dir, file), 'utf8').then(
        () => true,
        () => false,
      );

    it('refuses a site with access rules, before building anything', async () => {
      await project({
        ...GOOD,
        'docs.json':
          '{"name":"T","access":{"rules":[{"paths":["/a"],"require":"basic","realm":"R"}]}}',
      });
      const t = makeEnv();
      expect(await run(['build', '--static'], t.env)).toBe(1);
      expect(t.errText()).toContain('has 1 `access` rule');
      expect(t.children).toHaveLength(0);
    });

    it('builds with the static switches, sets server files aside and writes the extra files', async () => {
      await project({
        ...GOOD,
        'docs.json':
          '{"name":"T","redirects":[{"source":"/old","destination":"/a"},{"source":"/x/:id","destination":"/a"}]}',
        'src/proxy.ts': 'export const proxy = 1;',
        'src/app/api/kudos/route.ts': 'export {}',
        'src/app/page.tsx': 'export {}',
      });
      const t = makeEnv();
      let during: boolean[] = [];
      let vars: Record<string, string | undefined> = {};
      const spawn = t.env.spawn;
      t.env.spawn = ((cmd: string, args: string[], options: SpawnOptions) => {
        vars = options.env as typeof vars;
        return spawn(cmd, args, options);
      }) as Env['spawn'];
      const done = run(
        ['build', '--static', '--base-path', 'demo/', '--debug'],
        t.env,
      );
      await vi.waitFor(() => expect(t.children).toHaveLength(1));
      during = [
        await exists('src/proxy.ts'),
        await exists('src/app/api/kudos/route.ts'),
        await exists('src/app/page.tsx'),
      ];
      expect(during).toEqual([false, false, true]);
      expect(t.children[0]!.args.slice(1)).toEqual(['build', '--debug']);
      expect(vars).toMatchObject({
        DOCKUDOS_STATIC: '1',
        DOCKUDOS_BASE_PATH: '/demo',
      });
      t.children[0]!.child.emit('exit', 0);
      expect(await done).toBe(0);

      // Put back afterwards.
      expect(await exists('src/proxy.ts')).toBe(true);
      expect(await exists('src/app/api/kudos/route.ts')).toBe(true);
      expect(await exists('.dockudos/static-stash/src/proxy.ts')).toBe(false);
      // The extra files.
      expect(await exists('out/api/search/index')).toBe(true);
      expect(await readFile(join(dir, 'out/index.md'), 'utf8')).toContain('# ');
      expect(await exists('out/a.md')).toBe(true);
      expect(await readFile(join(dir, 'out/old/index.html'), 'utf8')).toContain(
        'url=/demo/a',
      );
      expect(t.errText()).toContain('1 redirect with patterns was not written');
      expect(t.text()).toContain('Static site written to out/');
    });

    it('puts the server files back and writes nothing when next fails', async () => {
      await project({ ...GOOD, 'src/proxy.ts': 'export const proxy = 1;' });
      const t = makeEnv();
      const done = run(['build', '--static', '--base-path=/p'], t.env);
      await vi.waitFor(() => expect(t.children).toHaveLength(1));
      t.children[0]!.child.emit('exit', 2);
      expect(await done).toBe(2);
      expect(await exists('src/proxy.ts')).toBe(true);
      expect(await exists('out/index.md')).toBe(false);
    });

    it('restores files left behind by an earlier crashed build', async () => {
      await project({
        ...GOOD,
        '.dockudos/static-stash/src/proxy.ts': 'export const proxy = 1;',
      });
      const t = makeEnv();
      const done = run(['build', '--static'], t.env);
      await vi.waitFor(() => expect(t.children).toHaveLength(1));
      // Restored, then set aside again for the build.
      expect(await exists('src/proxy.ts')).toBe(false);
      t.children[0]!.child.emit('exit', 0);
      await done;
      expect(await exists('src/proxy.ts')).toBe(true);
    });
  });

  it('explains when next is not installed', async () => {
    await writeFile(join(dir, 'docs.json'), '{"name":"T"}');
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'docs', 'index.mdx'), '# H');
    const t = makeEnv();
    expect(await run(['build'], t.env)).toBe(1);
    expect(t.errText()).toContain('Could not find `next`');
  });
});

describe('dev', () => {
  it('starts next dev and exits with its code', async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['dev', '-p', '4000'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    expect(t.children[0]!.args.slice(1)).toEqual(['dev', '-p', '4000']);
    t.children[0]!.child.emit('exit', 0);
    expect(await done).toBe(0);
  });

  it('fails fast on an invalid docs.json', async () => {
    await project({ ...GOOD, 'docs.json': '{' });
    const t = makeEnv();
    expect(await run(['dev'], t.env)).toBe(1);
    expect(t.errText()).toContain('not valid JSON');
    expect(t.children).toHaveLength(0);
  });

  it('restarts when docs.json changes to something valid', async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['dev'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));

    await writeFile(join(dir, 'docs.json'), '{"name":"Renamed"}');
    t.watchers[0]!();
    await vi.waitFor(() => expect(t.children[0]!.child.killed).toBe('SIGTERM'));
    await vi.waitFor(() => expect(t.children).toHaveLength(2));
    expect(t.text()).toContain('docs.json changed, restarting');

    t.children[1]!.child.emit('exit', 0);
    expect(await done).toBe(0);
  });

  it('keeps running and reports the problem when docs.json becomes invalid', async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['dev'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));

    await writeFile(join(dir, 'docs.json'), '{"name":""}');
    t.watchers[0]!();
    await vi.waitFor(() =>
      expect(t.errText()).toContain('Keeping the previous config'),
    );
    expect(t.children).toHaveLength(1);
    expect(t.children[0]!.child.killed).toBeUndefined();

    t.children[0]!.child.emit('exit', 0);
    await done;
  });

  it('debounces a burst of change events into one restart', async () => {
    await project(GOOD);
    const t = makeEnv();
    const done = run(['dev'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    t.watchers[0]!();
    t.watchers[0]!();
    t.watchers[0]!();
    await vi.waitFor(() => expect(t.children).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(t.children).toHaveLength(2);
    t.children[1]!.child.emit('exit', 0);
    await done;
  });

  describe('with an API spec in the project', () => {
    const SPEC = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Pets', version: '1' },
      paths: { '/pets': { get: { responses: { '200': {} } } } },
    });
    const WITH_SPEC = {
      ...GOOD,
      'docs.json': JSON.stringify({
        name: 'T',
        openapi: { sources: [{ name: 'pets', spec: 'pets.json' }] },
      }),
      'pets.json': SPEC,
    };

    it('writes the pages again when the spec changes, and keeps the server running', async () => {
      await project(WITH_SPEC);
      const t = makeEnv();
      const done = run(['dev'], t.env);
      await vi.waitFor(() => expect(t.children).toHaveLength(1));
      // The spec is watched first, docs.json second.
      expect(t.watchers).toHaveLength(2);
      t.watchers[0]!();
      t.watchers[0]!(); // a burst collapses into one run
      await new Promise((r) => setTimeout(r, 400));
      expect(t.errText()).toBe('');
      expect(t.children).toHaveLength(1);
      t.children[0]!.child.emit('exit', 0);
      await done;
    });

    it('reports a spec that stopped being valid and keeps the previous pages', async () => {
      await project(WITH_SPEC);
      const t = makeEnv();
      const done = run(['dev'], t.env);
      await vi.waitFor(() => expect(t.children).toHaveLength(1));
      await writeFile(join(dir, 'pets.json'), '{ nope');
      t.watchers[0]!();
      await vi.waitFor(() =>
        expect(t.errText()).toContain('Keeping the previous pages'),
      );
      t.children[0]!.child.emit('exit', 0);
      await done;
    });
  });
});

describe('kudos', () => {
  const log = (rows: object[]) =>
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const at = '2026-01-01T00:00:00.000Z';

  async function withLog(rows: object[], extra = '') {
    await mkdir(join(dir, '.dockudos'), { recursive: true });
    await writeFile(join(dir, '.dockudos', 'kudos.jsonl'), log(rows) + extra);
  }

  it('summarizes votes and comments per page', async () => {
    await withLog([
      { id: 'a', at, path: '/guide', vote: 'down' },
      { id: 'b', at, path: '/guide', vote: 'up' },
      { id: 'a', at, path: '/guide', comment: 'Step 2\nis wrong' },
      { id: 'c', at, path: '/other', vote: 'up' },
    ]);
    const t = makeEnv();
    expect(await run(['kudos'], t.env)).toBe(0);
    expect(t.text()).toContain('2 helpful, 1 not helpful, on 2 pages.');
    expect(t.text()).toMatch(/\/guide\s+1 up\s+1 down/);
    expect(t.text()).toContain('- Step 2 is wrong');
  });

  it('filters by page, prints JSON, and reports unreadable lines', async () => {
    await withLog(
      [
        { id: 'a', at, path: '/guide', vote: 'up' },
        { id: 'b', at, path: '/other', vote: 'up' },
      ],
      'garbage\n',
    );
    const one = makeEnv();
    await run(['kudos', '--path', '/other'], one.env);
    expect(one.text()).not.toContain('/guide');
    expect(one.text()).toContain('1 unreadable line');
    const json = makeEnv();
    await run(['kudos', '--json'], json.env);
    expect(JSON.parse(json.text()).skipped).toBe(1);
  });

  it('says so when there is nothing yet or no log', async () => {
    const t = makeEnv();
    expect(await run(['kudos'], t.env)).toBe(1);
    expect(t.errText()).toContain('No feedback log');
    await withLog([]);
    const u = makeEnv();
    expect(await run(['kudos'], u.env)).toBe(0);
    expect(u.text()).toBe('No feedback yet.\n');
  });
});

describe('pdf', () => {
  /** Lets the fake `next build` finish, then waits for the server to be started. */
  async function finishBuild(t: ReturnType<typeof makeEnv>) {
    await vi.waitFor(() => expect(t.children.length).toBeGreaterThanOrEqual(1));
    t.children[0]!.child.emit('exit', 0);
    await vi.waitFor(() => expect(t.children).toHaveLength(2));
  }

  it('builds, starts the site on a free port, prints /print to one file, and stops the server', async () => {
    await project({ ...GOOD, 'docs.json': '{"name":"Acme Docs"}' });
    const renderPdf = vi.fn(async () =>
      new TextEncoder().encode('%PDF-1.7 content'),
    );
    const t = makeEnv({ renderPdf });
    const done = run(['pdf'], t.env);
    await finishBuild(t);

    expect(t.children[0]!.args.slice(1)).toEqual(['build']);
    expect(t.children[1]!.args.slice(1)).toEqual([
      'start',
      '-p',
      '4555',
      '-H',
      '127.0.0.1',
    ]);
    expect(await done).toBe(0);
    expect(renderPdf).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:4555/print',
      chrome: undefined,
      pageSize: 'A4',
      title: 'Acme Docs',
      timeout: 120_000,
    });
    expect(await readFile(join(dir, 'acme-docs.pdf'), 'utf8')).toBe(
      '%PDF-1.7 content',
    );
    expect(t.text()).toContain('acme-docs.pdf');
    expect(t.children[1]!.child.killed).toBe('SIGTERM');
  });

  it('honours --out, --page-size, --chrome and --port', async () => {
    await project({ ...GOOD, '.next/BUILD_ID': 'x' });
    const renderPdf = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    const t = makeEnv({ renderPdf });
    const code = await run(
      [
        'pdf',
        '--no-build',
        '-o',
        'out/book.pdf',
        '--page-size',
        'letter',
        '--chrome',
        '/x/chrome',
        '--port',
        '4777',
      ],
      t.env,
    );
    expect(code).toBe(0);
    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://127.0.0.1:4777/print',
        chrome: '/x/chrome',
        pageSize: 'Letter',
      }),
    );
    expect((await stat(join(dir, 'out', 'book.pdf'))).isFile()).toBe(true);
    expect(t.children).toHaveLength(1);
  });

  it('with --no-build, asks for a build when there is none', async () => {
    await project(GOOD);
    const t = makeEnv();
    expect(await run(['pdf', '--no-build'], t.env)).toBe(1);
    expect(t.errText()).toContain('no build to print');
    expect(t.children).toHaveLength(0);
  });

  it('stops without printing when the build fails', async () => {
    await project(GOOD);
    const renderPdf = vi.fn();
    const t = makeEnv({ renderPdf });
    const done = run(['pdf'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    t.children[0]!.child.emit('exit', 2);
    expect(await done).toBe(2);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('says how to add the /print page when the site does not have it', async () => {
    await project(GOOD);
    const t = makeEnv({ fetch: async () => ({ status: 404 }) });
    const done = run(['pdf'], t.env);
    await finishBuild(t);
    expect(await done).toBe(1);
    expect(t.errText()).toContain('no /print page');
    expect(t.children[1]!.child.killed).toBe('SIGTERM');
  });

  it('reports why the server stopped, with its output', async () => {
    await project(GOOD);
    const t = makeEnv({
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const done = run(['pdf'], t.env);
    await finishBuild(t);
    (t.children[1]!.child as unknown as { stderr: EventEmitter }).stderr =
      new EventEmitter();
    t.children[1]!.child.emit('exit', 1);
    expect(await done).toBe(1);
    expect(t.errText()).toContain('server stopped before it was ready');
  });

  it('keeps the server from outliving a failed print', async () => {
    await project(GOOD);
    const t = makeEnv({
      renderPdf: async () => {
        throw new Error('browser crashed');
      },
    });
    const outcome = run(['pdf'], t.env).then(
      () => undefined,
      (e: Error) => e,
    );
    await finishBuild(t);
    expect((await outcome)?.message).toBe('browser crashed');
    expect(t.children[1]!.child.killed).toBe('SIGTERM');
  });

  it('rejects an unknown page size and a bad timeout before doing any work', async () => {
    await project(GOOD);
    const t = makeEnv();
    expect(await run(['pdf', '--page-size', 'A0'], t.env)).toBe(1);
    expect(t.errText()).toContain('Use A4 or Letter');
    expect(await run(['pdf', '--timeout', 'soon'], t.env)).toBe(1);
    expect(t.children).toHaveLength(0);
  });
});

describe('pdf: protected /print', () => {
  async function finishBuild(t: ReturnType<typeof makeEnv>) {
    await vi.waitFor(() => expect(t.children.length).toBeGreaterThanOrEqual(1));
    t.children[0]!.child.emit('exit', 0);
    await vi.waitFor(() => expect(t.children).toHaveLength(2));
  }

  it('sends basic credentials to the readiness check and to the browser', async () => {
    await project(GOOD);
    const calls: (Record<string, string> | undefined)[] = [];
    const renderPdf = vi.fn(async () => new Uint8Array([37]));
    const t = makeEnv({
      renderPdf,
      fetch: async (_u, headers) => (
        calls.push(headers),
        { status: headers ? 200 : 401 }
      ),
    });
    const done = run(['pdf', '--user', 'ada:pa:ss'], t.env);
    await finishBuild(t);
    expect(await done).toBe(0);
    expect(calls[0]).toEqual({
      authorization: `Basic ${Buffer.from('ada:pa:ss').toString('base64')}`,
    });
    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'ada', password: 'pa:ss' } }),
    );
  });

  it('takes a token, and reads credentials from the environment', async () => {
    await project(GOOD);
    const renderPdf = vi.fn(async () => new Uint8Array([37]));
    const a = makeEnv({ renderPdf });
    const doneA = run(['pdf', '--token', 'tok-12345678'], a.env);
    await finishBuild(a);
    await doneA;
    expect(renderPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: { token: 'tok-12345678' } }),
    );

    const b = makeEnv({ renderPdf, vars: { DOCKUDOS_PDF_AUTH: 'env:user' } });
    const doneB = run(['pdf'], b.env);
    await finishBuild(b);
    await doneB;
    expect(renderPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: { user: 'env', password: 'user' } }),
    );
  });

  it('explains what to do when the page is protected and no credentials were given, or were wrong', async () => {
    await project(GOOD);
    const none = makeEnv({ fetch: async () => ({ status: 401 }) });
    const doneNone = run(['pdf'], none.env);
    await finishBuild(none);
    expect(await doneNone).toBe(1);
    expect(none.errText()).toContain('is protected');
    expect(none.errText()).toContain('--user');

    const wrong = makeEnv({ fetch: async () => ({ status: 401 }) });
    const doneWrong = run(['pdf', '--user', 'a:b'], wrong.env);
    await finishBuild(wrong);
    expect(await doneWrong).toBe(1);
    expect(wrong.errText()).toContain('refused the credentials');
    expect(wrong.children[1]!.child.killed).toBe('SIGTERM');
  });

  it('says when the secret is missing from the server’s environment, and rejects a malformed --user', async () => {
    await project(GOOD);
    const t = makeEnv({ fetch: async () => ({ status: 503 }) });
    const done = run(['pdf'], t.env);
    await finishBuild(t);
    expect(await done).toBe(1);
    expect(t.errText()).toContain('secret is not set');
    const u = makeEnv();
    expect(await run(['pdf', '--user', 'nocolon'], u.env)).toBe(1);
    expect(u.errText()).toContain('user:password');
  });
});

describe('findChrome', () => {
  it('prefers the flag, then CHROME_PATH, and refuses a path that does not exist', async () => {
    const real = join(dir, 'chrome');
    await writeFile(real, '');
    expect(await findChrome(real, {})).toBe(real);
    expect(await findChrome(undefined, { CHROME_PATH: real })).toBe(real);
    await expect(findChrome(join(dir, 'nope'), {})).rejects.toThrow(
      'not found at',
    );
  });

  it('uses the browser Playwright installed, and explains what to do when there is none', async () => {
    const own = join(dir, 'pw-chromium');
    await writeFile(own, '');
    expect(await findChrome(undefined, {}, () => own)).toBe(own);
    await expect(
      findChrome(undefined, {}, () => {
        throw new Error('no browser');
      }).catch((e) => e.message),
    ).resolves.toMatch(/No Chrome|^\//);
  });
});

describe('pdf: the server it starts', () => {
  async function finishBuild(t: ReturnType<typeof makeEnv>) {
    await vi.waitFor(() => expect(t.children.length).toBeGreaterThanOrEqual(1));
    t.children[0]!.child.emit('exit', 0);
    await vi.waitFor(() => expect(t.children).toHaveLength(2));
  }

  it('refuses a port that is not one', async () => {
    await project({ ...GOOD, '.next/BUILD_ID': 'x' });
    const t = makeEnv();
    expect(await run(['pdf', '--no-build', '--port', '70000'], t.env)).toBe(1);
    expect(t.errText()).toContain('--port must be a port number');
    expect(t.children).toHaveLength(0);
  });

  it('reports a server that fails to start', async () => {
    await project(GOOD);
    const t = makeEnv({
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const done = run(['pdf'], t.env);
    await finishBuild(t);
    const server = t.children[1]!.child as unknown as {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    server.stdout = new EventEmitter();
    server.stderr = new EventEmitter();
    // A server that cannot even start reports the same way as one that stops.
    t.children[1]!.child.emit('error', new Error('spawn failed'));
    expect(await done).toBe(1);
    expect(t.errText()).toContain('server stopped before it was ready');
  });

  it('collects the output of the server for the message', async () => {
    await project(GOOD);
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const t = makeEnv({
      spawn: ((_cmd: string, args: string[]) => {
        const child = new FakeChild() as FakeChild & {
          stdout?: EventEmitter;
          stderr?: EventEmitter;
        };
        if (args[1] === 'start') {
          child.stdout = stdout;
          child.stderr = stderr;
          setTimeout(() => {
            stdout.emit('data', 'listening on 4555\n');
            stderr.emit('data', 'EADDRINUSE\n');
            child.emit('exit', 1);
          }, 20);
        } else setTimeout(() => child.emit('exit', 0), 5);
        return child as unknown as ChildProcess;
      }) as Env['spawn'],
      // Not ready yet: the check looks again after the server has already stopped.
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await run(['pdf'], t.env)).toBe(1);
    expect(t.errText()).toContain('EADDRINUSE');
  });

  it('reports the size in MB for a large file', async () => {
    await project({ ...GOOD, '.next/BUILD_ID': 'x' });
    const t = makeEnv({
      renderPdf: async () => new Uint8Array(3 * 1024 * 1024),
    });
    const done = run(['pdf', '--no-build'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    expect(await done).toBe(0);
    expect(t.text()).toContain('3.0 MB');
  });
});
