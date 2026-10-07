import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from './build.ts';
import { CliError, type Env } from './io.ts';
import { resolveNext } from './next-bin.ts';
import { loadProject } from './project.ts';
import { exitCode } from './spawn.ts';

const READY_TIMEOUT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'docs';

/**
 * `dockudos pdf`: build the site, serve it, and print the `/print` page (every page in one
 * document) to a single PDF with headless Chrome.
 */
export async function pdf(env: Env, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string', short: 'o' },
      'no-build': { type: 'boolean', default: false },
      port: { type: 'string' },
      chrome: { type: 'string' },
      'page-size': { type: 'string', default: 'A4' },
      timeout: { type: 'string', default: '120' },
    },
  });

  const pageSize =
    (values['page-size'] ?? 'A4').toLowerCase() === 'letter'
      ? 'Letter'
      : (values['page-size'] ?? 'A4').toLowerCase() === 'a4'
        ? 'A4'
        : undefined;
  if (!pageSize)
    throw new CliError(
      `Unknown page size "${values['page-size']}". Use A4 or Letter.`,
    );
  const timeout = Number(values.timeout) * 1000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new CliError('--timeout must be a number of seconds.');

  const project = await loadProject(env.cwd);
  const out = resolve(
    env.cwd,
    values.out ?? `${slug(project.config.name)}.pdf`,
  );

  if (values['no-build']) {
    const built = await stat(join(env.cwd, '.next', 'BUILD_ID')).then(
      () => true,
      () => false,
    );
    if (!built)
      throw new CliError(
        'There is no build to print. Run `dockudos build` first, or leave out --no-build.',
      );
  } else {
    const code = await build(env, []);
    if (code !== 0) return code;
  }

  const port = values.port ? Number(values.port) : await env.freePort();
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new CliError('--port must be a port number.');
  const url = `http://127.0.0.1:${port}`;

  env.out('Starting the site to print it...\n');
  const server = env.spawn(
    process.execPath,
    [resolveNext(env.cwd), 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: env.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env.vars,
    },
  );
  let log = '';
  server.stdout?.on('data', (d) => (log += String(d)));
  server.stderr?.on('data', (d) => (log += String(d)));
  let exited = false;
  void exitCode(server).then(
    () => (exited = true),
    () => (exited = true),
  );

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (exited)
        throw new CliError(
          `The server stopped before it was ready:\n${log.trim().split('\n').slice(-10).join('\n')}`,
        );
      try {
        const res = await env.fetch(`${url}/print`);
        if (res.status === 200) break;
        if (res.status === 404) {
          throw new CliError(
            'The site has no /print page. Add src/app/print/page.tsx (see the "Printing and PDF" guide), or create the site again with `dockudos init`.',
          );
        }
      } catch (e) {
        if (e instanceof CliError) throw e;
        // not listening yet
      }
      if (Date.now() > deadline)
        throw new CliError(
          `The server did not start within ${READY_TIMEOUT_MS / 1000} seconds.`,
        );
      await sleep(250);
    }

    env.out('Printing...\n');
    const bytes = await env.renderPdf({
      url: `${url}/print`,
      chrome: values.chrome,
      pageSize,
      title: project.config.name,
      timeout,
    });
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    const kb = Math.max(1, Math.round(bytes.length / 1024));
    env.out(
      `Wrote ${out} (from ${project.tree.pages.length} pages, ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB`}).\n`,
    );
    return 0;
  } finally {
    server.kill('SIGTERM');
    await Promise.race([sleep(2000), exitCode(server).catch(() => undefined)]);
  }
}
