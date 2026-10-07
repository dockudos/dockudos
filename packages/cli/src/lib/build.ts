import { buildSiteIndex, writeIndexFile } from '@dockudos/core/node';
import { type Env, CliError } from './io.ts';
import { resolveNext } from './next-bin.ts';
import { findBrokenLinks, loadProject } from './project.ts';
import { exitCode } from './spawn.ts';

/** Validate the project, check links, then run `next build`. */
export async function build(env: Env, args: string[]): Promise<number> {
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

  const { index, reusedPages } = await buildSiteIndex({
    root: env.cwd,
    docsDir: project.docsDir,
    config: project.config,
    tree: project.tree,
  });
  await writeIndexFile(env.cwd, index);
  const n = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;
  env.out(
    `Indexed ${n(index.pages.length, 'page')} into ${n(index.chunks.length, 'chunk')} (${reusedPages} reused).\n`,
  );

  return exitCode(
    env.spawn(process.execPath, [next, 'build', ...args], {
      cwd: env.cwd,
      stdio: 'inherit',
      env: env.vars,
    }),
  );
}

export { CliError };
