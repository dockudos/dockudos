import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { edit } from './edit.ts';
import { type Env } from './io.ts';
import { run } from './run.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dkd-edit-cmd-'));
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs.json'), '{"name":"A","navigation":[]}');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function makeEnv(overrides: Partial<Env> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: { cmd: string; args: string[]; options: SpawnOptions }[] = [];
  const env: Env = {
    cwd: dir,
    vars: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    interactive: false,
    ask: async (_q, fallback) => fallback,
    spawn: ((cmd: string, args: string[], options: SpawnOptions) => {
      spawned.push({ cmd, args, options });
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => undefined;
      return child as unknown as ChildProcess;
    }) as Env['spawn'],
    watch: () => ({ close: () => undefined }),
    freePort: async () => 0,
    fetch: async () => ({ status: 200 }),
    stdinLines: async function* () {
      /* no input */
    },
    renderPdf: async () => new Uint8Array(),
    ...overrides,
  };
  return {
    env,
    out,
    err,
    spawned,
    text: () => out.join(''),
    errText: () => err.join(''),
  };
}

/** Run the command, wait for it to print its address, stop it the way Ctrl+C does, and return the exit code. */
async function runAndStop(
  env: Env,
  args: string[],
  ctx: { text: () => string },
) {
  const done = edit(env, args);
  for (let i = 0; i < 200 && !/Press Ctrl\+C/.test(ctx.text()); i++)
    await new Promise((r) => setTimeout(r, 10));
  process.emit('SIGINT');
  return done;
}

describe('dockudos edit', () => {
  it('is listed in the help and routed by the CLI', async () => {
    const t = makeEnv();
    expect(await run(['--help'], t.env)).toBe(0);
    expect(t.text()).toContain('edit [folder]');
  });

  it('serves the folder on a loopback address, prints it, and stops on Ctrl+C', async () => {
    const t = makeEnv();
    const code = await runAndStop(
      t.env,
      [dir, '--no-open', '--ui', join(dir, 'no-interface-here')],
      t,
    );
    expect(code).toBe(0);
    expect(t.text()).toContain(`Editing ${dir}`);
    expect(t.text()).toMatch(/http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
    expect(t.errText()).toContain('not built yet');
    expect(t.spawned).toEqual([]);
  });

  it('uses the working folder when none is given, and --ui to find the interface', async () => {
    const ui = await mkdtemp(join(tmpdir(), 'dkd-edit-ui-'));
    await writeFile(join(ui, 'index.html'), '<h1>ui</h1>');
    const t = makeEnv();
    const code = await runAndStop(t.env, ['--ui', ui], t);
    expect(code).toBe(0);
    expect(t.errText()).toBe('');
    await rm(ui, { recursive: true, force: true });
  });

  it('opens the browser when run from a terminal, and says what to do if that fails', async () => {
    const t = makeEnv({ interactive: true });
    await runAndStop(t.env, [dir], t);
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.args.at(-1)).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/\?t=/,
    );
    expect(t.spawned[0]!.options).toMatchObject({
      stdio: 'ignore',
      detached: true,
    });

    const failing = makeEnv({
      interactive: true,
      spawn: (() => {
        throw new Error('no xdg-open');
      }) as Env['spawn'],
    });
    expect(await runAndStop(failing.env, [dir], failing)).toBe(0);
    expect(failing.text()).toContain('Press Ctrl+C');
  });

  it('tells the person to open the address when the opener fails after starting', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => undefined;
    const t = makeEnv({
      interactive: true,
      spawn: (() => child) as unknown as Env['spawn'],
    });
    const done = edit(t.env, [dir]);
    for (let i = 0; i < 200 && !/Press Ctrl\+C/.test(t.text()); i++)
      await new Promise((r) => setTimeout(r, 10));
    child.emit('error', new Error('ENOENT'));
    process.emit('SIGINT');
    await done;
    expect(t.text()).toContain('Open the address above in your browser.');
  });

  it('rejects a folder that does not exist and a port that is not a port', async () => {
    const t = makeEnv();
    expect(await run(['edit', join(dir, 'nope')], t.env)).toBe(1);
    expect(t.errText()).toContain('is not a folder');
    for (const port of ['abc', '70000', '1.5']) {
      const u = makeEnv();
      expect(await run(['edit', dir, '--port', port], u.env)).toBe(1);
      expect(u.errText()).toContain('--port must be a number');
    }
    const negative = makeEnv();
    expect(await run(['edit', dir, '--port=-1'], negative.env)).toBe(1);
    expect(negative.errText()).toContain('--port must be a number');
  });

  it('explains when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    const t = makeEnv();
    expect(await run(['edit', dir, '--port', String(port)], t.env)).toBe(1);
    expect(t.errText()).toContain(`Port ${port} is already in use`);
    await new Promise((r) => blocker.close(r));
  });
});
