import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { type Env } from './io.ts';
import { resolveNext } from './next-bin.ts';
import { loadProject } from './project.ts';
import { exitCode } from './spawn.ts';

const DEBOUNCE_MS = 150;

/**
 * Run `next dev`. MDX edits hot-reload through Next; `docs.json` is read by
 * `next.config` at start-up, so a change to it restarts the dev server.
 * A `docs.json` that does not validate is reported and the running server is left alone.
 */
export async function dev(env: Env, args: string[]): Promise<number> {
  await loadProject(env.cwd); // fail fast with a readable message
  const next = resolveNext(env.cwd);
  const start = () =>
    env.spawn(process.execPath, [next, 'dev', ...args], {
      cwd: env.cwd,
      stdio: 'inherit',
      env: env.vars,
    });

  let child: ChildProcess = start();
  let restarting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const watcher = env.watch(join(env.cwd, 'docs.json'), () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await loadProject(env.cwd);
      } catch (e) {
        env.err(
          `\n${(e as Error).message}\nKeeping the previous config until docs.json is valid.\n`,
        );
        return;
      }
      env.out('\ndocs.json changed, restarting...\n');
      restarting = true;
      child.kill('SIGTERM');
    }, DEBOUNCE_MS);
  });

  // Loop: when we killed the child to restart it, start a new one instead of exiting.
  for (;;) {
    const code = await exitCode(child);
    if (!restarting) {
      clearTimeout(timer);
      watcher.close();
      return code;
    }
    restarting = false;
    child = start();
  }
}
