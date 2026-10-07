import { brokenLinks } from './broken-links.ts';
import { build } from './build.ts';
import { dev } from './dev.ts';
import { init } from './init.ts';
import { kudos } from './kudos.ts';
import { pdf } from './pdf.ts';
import { type Env, CliError } from './io.ts';

const HELP = `dockudos: documentation sites for Next.js

Usage: dockudos <command> [options]

Commands:
  init [folder]     Create a new docs site (--name, --package-manager, --yes)
  dev [next args]   Start the dev server; restarts when docs.json changes
  build [next args] Validate docs.json, check links, then build the site
  broken-links      Check internal links and anchors (--external also checks http links)
  pdf               Print every page into one PDF (-o file, --no-build, --page-size, --chrome)
  kudos             Show page feedback collected by the kudos widget (--path, --json, --file)

Options:
  -h, --help        Show this help
  -v, --version     Show the version
`;

const COMMANDS: Record<string, (env: Env, args: string[]) => Promise<number>> =
  {
    init,
    dev,
    build,
    'broken-links': brokenLinks,
    kudos,
    pdf,
  };

/** Run the CLI. Returns the process exit code; never throws for expected failures. */
export async function run(
  argv: string[],
  env: Env,
  version = '',
): Promise<number> {
  const [command, ...rest] = argv;
  if (
    !command ||
    command === '-h' ||
    command === '--help' ||
    command === 'help'
  ) {
    env.out(HELP);
    return command ? 0 : 1;
  }
  if (command === '-v' || command === '--version') {
    env.out(`${version}\n`);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    env.err(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  try {
    return await handler(env, rest);
  } catch (e) {
    if (e instanceof CliError) {
      env.err(`${e.message}\n`);
      return e.code;
    }
    // parseArgs throws a TypeError with a usable message for bad flags.
    if (
      e instanceof TypeError &&
      'code' in e &&
      String((e as { code: unknown }).code).startsWith('ERR_PARSE_ARGS')
    ) {
      env.err(`${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
