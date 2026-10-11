import { brokenLinks } from './broken-links.ts';
import { build } from './build.ts';
import { dev } from './dev.ts';
import { generate } from './generate.ts';
import { init } from './init.ts';
import { indexCommand } from './index-command.ts';
import { kudos } from './kudos.ts';
import { mcp } from './mcp.ts';
import { epub } from './epub.ts';
import { pdf } from './pdf.ts';
import { sync } from './sync.ts';
import { type Env, CliError } from './io.ts';

const HELP = `dockudos: documentation sites for Next.js

Usage: dockudos <command> [options]

Commands:
  init [folder]     Create a new docs site (--name, --package-manager, --yes)
  dev [next args]   Start the dev server; restarts when docs.json changes
  build [next args] Sync sources, validate docs.json, check links, then build the site (--static for a plain-file site in out/, --base-path /name for a sub-path, --no-sync to skip the sources)
  generate          Write API reference pages from the specs in docs.json (--force)
  index             Build the search index (and embeddings, when configured) without building the site
  mcp               Serve the docs to AI coding tools over the Model Context Protocol (stdio)
  broken-links      Check internal links and anchors (--external also checks http links)
  sync [name...]    Fetch or convert the content sources of docs.json (remote, Obsidian, HTML, Notion, Sanity) into docs/
  pdf               Print pages into one PDF (-o file, --no-build, --page-size, --chrome, --user, --token, --path /guides, --version v1, --locale fr)
  epub              Write pages as an EPUB book (-o file, --path /guides, --version v1, --locale fr)
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
    generate,
    index: indexCommand,
    mcp,
    'broken-links': brokenLinks,
    kudos,
    pdf,
    epub,
    sync,
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
