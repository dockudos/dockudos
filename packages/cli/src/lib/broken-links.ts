import { parseArgs } from 'node:util';
import type { Env } from './io.ts';
import { generatePages } from './generate.ts';
import { findBrokenLinks, loadProject } from './project.ts';

/** Check internal links, anchors and assets (and external links with `--external`). Exits 1 on any error. */
export async function brokenLinks(env: Env, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { external: { type: 'boolean', default: false } },
  });
  await generatePages(env, { quiet: true });
  const project = await loadProject(env.cwd);
  const { errors, warnings, report } = await findBrokenLinks(env.cwd, project, {
    external: values.external,
  });

  if (report) (errors ? env.err : env.out)(report + '\n');
  if (errors > 0) {
    env.err(
      `\n${errors} broken link${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.\n`,
    );
    return 1;
  }
  env.out(
    `No broken links in ${project.tree.pages.length} pages${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}.\n`,
  );
  return 0;
}
