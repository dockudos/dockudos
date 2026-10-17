import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Env, CliError } from './io.ts';
import { startEditServer } from './edit/server.ts';

/** Where the built editor interface ships inside the package. */
const BUNDLED_UI = fileURLToPath(new URL('../../editor', import.meta.url));

function opener(): [string, string[]] | undefined {
  if (process.platform === 'darwin') return ['open', []];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '""']];
  return ['xdg-open', []];
}

/**
 * `dockudos edit [folder]`: open a docs folder in the browser editor. Pages are edited visually, saved as MDX
 * files and committed with Git. The server listens on the loopback interface only.
 */
export async function edit(env: Env, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      ui: { type: 'string' },
    },
  });
  const dir = resolve(env.cwd, positionals[0] ?? '.');
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) throw new CliError(`${dir} is not a folder.`);

  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new CliError(
      `--port must be a number from 0 to 65535, not "${values.port}".`,
    );

  const uiDir = resolve(env.cwd, values.ui ?? BUNDLED_UI);
  const hasUi = await stat(resolve(uiDir, 'index.html')).then(
    () => true,
    () => false,
  );

  let server;
  try {
    server = await startEditServer({ dir, port, ...(hasUi && { uiDir }) });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw new CliError(
        `Port ${port} is already in use. Pick another with --port.`,
      );
    throw e;
  }

  env.out(`Editing ${dir}\n\n  ${server.url}\n\n`);
  if (!hasUi)
    env.err(
      'The editor interface is not built yet; the page will say so. Pass --ui <folder> to use another build.\n',
    );
  env.out('Press Ctrl+C to stop.\n');

  if (!values['no-open'] && env.interactive) {
    const cmd = opener();
    if (cmd) {
      try {
        const child = env.spawn(cmd[0], [...cmd[1], server.url], {
          stdio: 'ignore',
          detached: true,
        });
        child.on?.('error', () =>
          env.out('Open the address above in your browser.\n'),
        );
        child.unref?.();
      } catch {
        /* the address is printed; opening is a convenience */
      }
    }
  }

  await new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await server.close();
  return 0;
}
