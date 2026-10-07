import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Env, CliError } from './io.ts';

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
type Pm = (typeof PACKAGE_MANAGERS)[number];

const NEXT_VERSION = '~16.1.6';

/** `templates/` sits next to `dist/` in the published package and next to `src/` in the repo. */
const templatesDir = fileURLToPath(
  new URL('../../templates/', import.meta.url),
);

const titleCase = (slug: string) =>
  slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'My Docs';

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'docs';

function detectPackageManager(userAgent = ''): Pm {
  const name = /^(npm|pnpm|yarn|bun)\//.exec(userAgent)?.[1];
  return (name as Pm | undefined) ?? 'npm';
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = (await readdir(dir)).filter((e) => e !== '.git');
    return entries.length === 0;
  } catch {
    return true; // does not exist yet
  }
}

async function ownVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../../package.json', import.meta.url)),
      'utf8',
    ),
  ) as { version: string };
  return pkg.version;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** `dockudos init [name]`: scaffold a docs site from `templates/default`. */
export async function init(env: Env, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      'package-manager': { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });

  const dirArg =
    positionals[0] ??
    (env.interactive && !values.yes
      ? await env.ask('Project folder', 'my-docs')
      : 'my-docs');
  const target = resolve(env.cwd, dirArg);
  if (!(await isEmptyDir(target))) {
    throw new CliError(
      `${target} is not empty. Choose a new folder, or empty this one first.`,
    );
  }

  const ask = env.interactive && !values.yes;
  const siteName =
    values.name ??
    (ask
      ? await env.ask('Site name', titleCase(basename(target)))
      : titleCase(basename(target)));

  const detected = detectPackageManager(env.vars['npm_config_user_agent']);
  const requested =
    values['package-manager'] ??
    (ask
      ? await env.ask(
          `Package manager (${PACKAGE_MANAGERS.join(', ')})`,
          detected,
        )
      : detected);
  if (!(PACKAGE_MANAGERS as readonly string[]).includes(requested)) {
    throw new CliError(
      `Unknown package manager "${requested}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`,
    );
  }
  const pm = requested as Pm;

  const version = await ownVersion();
  const tokens: Record<string, string> = {
    name: siteName.replace(/["\\]/g, ''),
    slug: slugify(basename(target)),
    version: version.startsWith('0.0.') ? version : `^${version}`,
    nextVersion: NEXT_VERSION,
    installCommand: `${pm} install`,
    runCommand: pm === 'npm' ? 'npm run' : pm,
  };

  await mkdir(target, { recursive: true });
  await cp(join(templatesDir, 'default'), target, { recursive: true });
  for await (const file of walk(target)) {
    const text = await readFile(file, 'utf8');
    const filled = text.replace(
      /\{\{(\w+)\}\}/g,
      (m, key: string) => tokens[key] ?? m,
    );
    if (filled !== text) await writeFile(file, filled);
  }
  // Some files ship under another name: npm drops `.gitignore` from packages, and tools that
  // scan the repo (Nx, TypeScript) would treat a real package.json or next.config here as a project.
  for await (const file of walk(target)) {
    const renamed =
      basename(file) === '_gitignore'
        ? join(dirname(file), '.gitignore')
        : file.endsWith('.tpl')
          ? file.slice(0, -4)
          : undefined;
    if (renamed) await rename(file, renamed);
  }

  const rel = dirArg === '.' ? '' : `cd ${dirArg}\n  `;
  env.out(
    `\nCreated ${siteName} in ${target}\n\nNext steps:\n  ${rel}${pm} install\n  ${pm === 'npm' ? 'npm run' : pm} dev\n\nThen open http://localhost:3000. Edit docs/ and docs.json to make it yours.\n`,
  );
  return 0;
}
