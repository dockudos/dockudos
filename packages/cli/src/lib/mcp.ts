import {
  type MarkdownComponents,
  createMcpServer,
  mcpParseError,
} from '@dockudos/core';
import { createSiteBackend } from '@dockudos/core/node';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Env } from './io.ts';
import { loadProject } from './project.ts';

/**
 * The components of the project's site, so pages read as Markdown like the site's own twins. The project has
 * `@dockudos/ui` when it has a site; without it (or if it will not load here) pages keep their content and lose
 * only the component formatting.
 */
export async function siteComponents(
  cwd: string,
): Promise<MarkdownComponents | undefined> {
  try {
    const entry = createRequire(join(cwd, 'package.json')).resolve(
      '@dockudos/ui',
    );
    const ui = (await import(pathToFileURL(entry).href)) as {
      mdxComponents?: MarkdownComponents;
    };
    return ui.mdxComponents;
  } catch {
    return undefined;
  }
}

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
      components: await siteComponents(env.cwd),
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
