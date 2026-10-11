import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Actor, createAuth } from '../auth.ts';
import { createBuilds } from '../builds.ts';
import type { Db } from '../db.ts';
import type { CommandRunner } from '../exec.ts';
import { createMemoryGit } from '../git/memory.ts';
import { createQueue, createWorker } from '../queue.ts';
import { createSites } from '../sites.ts';
import { apiSource } from '../sources.ts';
import { createMemoryStorage } from '../storage.ts';
import { createWebhookReceiver } from '../webhooks.ts';
import { createMetricsFixture } from './metrics-fixture.ts';

export const SECRET = 's'.repeat(40);

/** What the fake `dockudos build --static` writes. */
export const SITE_FILES: Record<string, string> = {
  'out/index.html': '<h1>Home</h1>',
  'out/guide/index.html': '<h1>Guide</h1>',
  'out/api.html': '<h1>API</h1>',
  'out/404.html': '<h1>Missing</h1>',
  'out/_next/static/app.js': 'console.log(1)',
  '.dockudos/index.json': JSON.stringify({
    version: 1,
    builtAt: 'x',
    pages: [],
    chunks: [],
  }),
};

let counter = 0;

export interface FixtureOptions {
  /** Override what a command does; return a code to stop the default. */
  onCommand?: (
    cmd: string,
    args: string[],
    cwd: string,
    onOutput?: (chunk: string) => void,
  ) => Promise<number | undefined>;
  secrets?: string[];
  files?: Record<string, string>;
  /** The content index the fake build publishes. */
  index?: unknown;
}

/** The whole backend wired together on an in-memory Git host, in-process Postgres and in-memory storage. */
export async function createFixture(db: Db, options: FixtureOptions = {}) {
  const clockState = { now: new Date('2026-03-01T12:00:00Z') };
  const clock = () => clockState.now;
  const git = createMemoryGit('github');
  const gitlab = createMemoryGit('gitlab');
  const storage = createMemoryStorage();
  const auth = createAuth({ db, secret: SECRET, clock });
  const queue = createQueue({ db, clock });
  const providers = { github: git, gitlab };
  const sites = createSites({ db, auth, providers, clock });
  const commands: {
    cmd: string;
    args: string[];
    cwd: string;
    env?: Record<string, string> | undefined;
  }[] = [];
  const run: CommandRunner = async ({ cmd, args, cwd, env, onOutput }) => {
    commands.push({ cmd, args, cwd, env });
    const custom = await options.onCommand?.(cmd, args, cwd, onOutput);
    if (custom !== undefined) return { code: custom };
    if (args.includes('build')) {
      for (const [p, c] of Object.entries(options.files ?? SITE_FILES)) {
        if (!p.startsWith('out/')) continue;
        await mkdir(join(cwd, p, '..'), { recursive: true });
        await writeFile(join(cwd, p), c);
      }
      await symlink('/etc/passwd', join(cwd, 'out', 'leak.txt')).catch(
        () => undefined,
      );
    }
    if (args.includes('index')) {
      await mkdir(join(cwd, '.dockudos'), { recursive: true });
      await writeFile(
        join(cwd, '.dockudos/index.json'),
        options.index
          ? JSON.stringify(options.index)
          : SITE_FILES['.dockudos/index.json']!,
      );
    }
    return { code: 0 };
  };
  const metrics = createMetricsFixture();
  const builds = createBuilds({
    db,
    queue,
    storage,
    sites,
    auth,
    providers,
    run,
    source: apiSource,
    clock,
    metrics,
    secrets: options.secrets ?? [],
    siteUrl: (s) => `https://${s.slug}.sites.test`,
  });
  const webhooks = createWebhookReceiver({ db, sites, builds, clock, metrics });
  const worker = createWorker({
    queue,
    handlers: { build: builds.handle },
    metrics,
  });

  const owner = await auth.upsertUser({
    sub: `owner-${Math.random()}`,
    email: `o${Math.random()}@x.test`,
    roles: [],
    groups: [],
  });
  const actor: Actor = { type: 'user', user: owner };
  const team = await auth.createTeam(actor, 'Fixture Team');
  const repo = `acme/docs-${++counter}`;
  git.seed(repo, {
    'docs.json': '{"name":"Acme"}',
    'index.mdx': '# Home',
    'package.json': '{}',
  });
  const { site, webhookSecret } = await sites.create(actor, team.id, {
    name: `Acme Docs ${counter}`,
    provider: 'github',
    repo,
  });

  return {
    repo,
    auth,
    queue,
    sites,
    builds,
    webhooks,
    worker,
    git,
    gitlab,
    storage,
    actor,
    owner,
    team,
    site,
    webhookSecret,
    metrics,
    commands,
    clock,
    clockState,
    providers,
    drain: async () => {
      while (await worker.runOnce());
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof createFixture>>;
