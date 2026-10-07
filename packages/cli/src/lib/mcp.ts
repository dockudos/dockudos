import { createMcpServer, mcpParseError } from '@dockudos/core';
import { createSiteBackend } from '@dockudos/core/node';
import type { Env } from './io.ts';
import { loadProject } from './project.ts';

/**
 * `dockudos mcp`: serve the docs of this project to AI coding tools over the Model Context Protocol, on
 * standard input and output. Nothing but protocol messages goes to standard output; problems go to
 * standard error. Register it with a tool, for example `claude mcp add docs -- npx dockudos mcp`.
 */
export async function mcp(env: Env, _args: string[]): Promise<number> {
  const project = await loadProject(env.cwd);
  const server = createMcpServer(
    {
      name: `${project.config.name} documentation`,
      version: '1',
      instructions: `Search and read the documentation of ${project.config.name}. Use search_docs to find sections, then get_page for a whole page.`,
    },
    await createSiteBackend({
      root: env.cwd,
      docsDir: project.docsDir,
      config: project.config,
      tree: project.tree,
    }),
  );
  for await (const line of env.stdinLines()) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      env.out(`${JSON.stringify(mcpParseError())}\n`);
      continue;
    }
    const reply = await server.handle(message);
    if (reply !== undefined) env.out(`${JSON.stringify(reply)}\n`);
  }
  return 0;
}
