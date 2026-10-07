export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * Rewrite one npm command for the other package managers, so docs are written
 * once. Supports `install`/`i` (with `-D`/`-g`), `uninstall`, `run`, `create`,
 * `init`, `exec`, `test`/`start`, and `npx`. Anything else is returned unchanged
 * for every manager, so a typo is visible rather than silently wrong.
 */
export function convertPackageCommand(
  command: string,
): Record<PackageManager, string> {
  const same = { npm: command, pnpm: command, yarn: command, bun: command };
  const parts = command.trim().split(/\s+/);
  const [bin, sub = '', ...rest] = parts;

  if (bin === 'npx') {
    const args = parts.slice(1).join(' ');
    return {
      npm: command,
      pnpm: `pnpm dlx ${args}`,
      yarn: `yarn dlx ${args}`,
      bun: `bunx ${args}`,
    };
  }
  if (bin !== 'npm') return same;

  const flags = rest.filter((r) => r.startsWith('-'));
  const args = rest.filter((r) => !r.startsWith('-'));
  const isDev = flags.some((f) => f === '-D' || f === '--save-dev');
  const isGlobal = flags.some((f) => f === '-g' || f === '--global');
  const other = flags.filter(
    (f) => !['-D', '--save-dev', '-g', '--global'].includes(f),
  );
  const join = (...p: (string | false | undefined)[]) =>
    p.filter(Boolean).join(' ');

  switch (sub) {
    case 'install':
    case 'i':
    case 'add': {
      if (args.length === 0) {
        return {
          npm: command,
          pnpm: 'pnpm install',
          yarn: 'yarn install',
          bun: 'bun install',
        };
      }
      return {
        npm: command,
        pnpm: join(
          'pnpm add',
          isGlobal && '-g',
          isDev && '-D',
          ...other,
          ...args,
        ),
        yarn: isGlobal
          ? join('yarn global add', ...other, ...args)
          : join('yarn add', isDev && '-D', ...other, ...args),
        bun: join(
          'bun add',
          isGlobal && '-g',
          isDev && '-d',
          ...other,
          ...args,
        ),
      };
    }
    case 'uninstall':
    case 'remove':
    case 'rm':
      return {
        npm: command,
        pnpm: join('pnpm remove', isGlobal && '-g', ...args),
        yarn: isGlobal
          ? join('yarn global remove', ...args)
          : join('yarn remove', ...args),
        bun: join('bun remove', isGlobal && '-g', ...args),
      };
    case 'run':
    case 'run-script': {
      const [script, ...extra] = rest;
      const tail = extra.length ? ` ${extra.join(' ')}` : '';
      return {
        npm: command,
        pnpm: `pnpm run ${script}${tail}`,
        yarn: `yarn ${script}${tail}`,
        bun: `bun run ${script}${tail}`,
      };
    }
    case 'test':
    case 'start':
    case 'build':
      return {
        npm: command,
        pnpm: `pnpm ${sub}${rest.length ? ' ' + rest.join(' ') : ''}`,
        yarn: `yarn ${sub}${rest.length ? ' ' + rest.join(' ') : ''}`,
        bun: `bun run ${sub}${rest.length ? ' ' + rest.join(' ') : ''}`,
      };
    case 'create':
    case 'init': {
      const tail = rest.length ? ` ${rest.join(' ')}` : '';
      return {
        npm: command,
        pnpm: `pnpm create${tail}`,
        yarn: `yarn create${tail}`,
        bun: `bun create${tail}`,
      };
    }
    case 'exec': {
      const tail = rest.filter((r) => r !== '--').join(' ');
      return {
        npm: command,
        pnpm: `pnpm exec ${tail}`,
        yarn: `yarn ${tail}`,
        bun: `bunx ${tail}`,
      };
    }
    default:
      return same;
  }
}
