import { generatePages } from './generate.ts';
import { syncSources } from './sync.ts';
import { indexSite } from './index-site.ts';
import { type Env, CliError } from './io.ts';
import { resolveNext } from './next-bin.ts';
import { findBrokenLinks, loadProject } from './project.ts';
import { exitCode } from './spawn.ts';
import {
  protectedPages,
  normalizeBasePath,
  withoutServerFiles,
  writeStaticAssets,
} from './static.ts';

/**
 * Validate the project, check links, then run `next build`.
 *
 * `--static` writes a plain-file site to `out/` that any static host can serve: no AI, feedback or
 * `access` rules (they need a server). `--base-path /name` is for hosts that serve from a sub-path.
 */
export async function build(env: Env, rawArgs: string[]): Promise<number> {
  const { args, isStatic, basePath, noSync } = parseStaticFlags(rawArgs);
  // Content from other places first: pages and navigation refer to it.
  if (!noSync) await syncSources(env);
  // API reference pages first: navigation and links refer to them.
  await generatePages(env);
  const project = await loadProject(env.cwd);
  env.out(`Checked docs.json and ${project.tree.pages.length} pages.\n`);

  const links = await findBrokenLinks(env.cwd, project);
  if (links.errors > 0) {
    throw new CliError(
      `Found ${links.errors} broken link${links.errors === 1 ? '' : 's'}:\n${links.report}\n\nFix them, or run \`dockudos broken-links\` to check again.`,
    );
  }

  // Resolve Next first: a missing install should fail before any work is done.
  const next = resolveNext(env.cwd);

  if (isStatic) {
    const left = protectedPages(project);
    if (left.length > 0)
      env.out(
        `Static build: leaving out ${left.length} page${left.length === 1 ? '' : 's'} behind \`access\` rules. A static site cannot keep them private, so it does not contain them.\n`,
      );
  }

  await indexSite(env, project);

  const run = () =>
    exitCode(
      env.spawn(process.execPath, [next, 'build', ...args], {
        cwd: env.cwd,
        stdio: 'inherit',
        env: isStatic
          ? { ...env.vars, DOCKUDOS_STATIC: '1', DOCKUDOS_BASE_PATH: basePath }
          : env.vars,
      }),
    );
  if (!isStatic) return run();

  const code = await withoutServerFiles(env, run);
  if (code !== 0) return code;
  await writeStaticAssets(
    { ...env, vars: { ...env.vars, DOCKUDOS_BASE_PATH: basePath } },
    project,
  );
  env.out(
    'Static site written to out/. Serve that folder with any file host.\n',
  );
  return 0;
}

function parseStaticFlags(raw: string[]) {
  const args: string[] = [];
  let isStatic = false;
  let noSync = false;
  let basePath = '';
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i] as string;
    if (arg === '--static') isStatic = true;
    else if (arg === '--no-sync') noSync = true;
    else if (arg === '--base-path') basePath = normalizeBasePath(raw[++i]);
    else if (arg.startsWith('--base-path='))
      basePath = normalizeBasePath(arg.slice('--base-path='.length));
    else args.push(arg);
  }
  return { args, isStatic, basePath, noSync };
}

export { CliError };
