import { indexSite } from './index-site.ts';
import type { Env } from './io.ts';
import { loadProject } from './project.ts';

/** `dockudos index`: build `.dockudos/index.json` (and embeddings) without building the site. */
export async function indexCommand(env: Env, _args: string[]): Promise<number> {
  const project = await loadProject(env.cwd);
  await indexSite(env, project);
  return 0;
}
