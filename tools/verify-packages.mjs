#!/usr/bin/env node
// Installs the published @dockudos/* packages from a registry (default: the local
// Verdaccio) into a scratch project, typechecks a consumer file and imports each
// package under plain Node ESM.
//
//   pnpm nx local-registry                      # terminal 1
//   pnpm nx release publish --registry http://localhost:4873/   # after building
//   pnpm verify:packages                        # terminal 2
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = process.env.REGISTRY ?? 'http://localhost:4873/';
const dir = mkdtempSync(join(tmpdir(), 'dockudos-consumer-'));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: dir, stdio: 'inherit', ...opts });

try {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  run('npm', [
    'install',
    '--registry',
    registry,
    '--no-audit',
    '--no-fund',
    '@dockudos/core',
    '@dockudos/next',
    '@dockudos/cli',
    '@dockudos/ui',
    'next@~16.1.6',
    'react@^19',
    'react-dom@^19',
    'typescript',
    '@types/react',
    '@types/node',
  ]);

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        jsx: 'react-jsx',
        skipLibCheck: true,
      },
      files: ['consumer.tsx'],
    }),
  );
  writeFileSync(
    join(dir, 'consumer.tsx'),
    `import { parseConfig, buildPageTree } from '@dockudos/core';
import { loadConfig } from '@dockudos/core/node';
import { withDocs } from '@dockudos/next';
import { cn, Button } from '@dockudos/ui';
import { cn as cn2 } from '@dockudos/ui/lib/utils';
import { run } from '@dockudos/cli';

const name: string = parseConfig({ name: 'x' }).name;
const pages: string[] = buildPageTree(['index.mdx']).pages.map((p) => p.path);
export const el = <Button className={cn('a', cn2('b'))}>{name}</Button>;
export { pages, loadConfig, withDocs, run };
`,
  );
  run('npx', ['tsc', '-p', 'tsconfig.json']);

  writeFileSync(
    join(dir, 'smoke.mjs'),
    `import { parseConfig } from '@dockudos/core';
import { loadConfig } from '@dockudos/core/node';
import { withDocs } from '@dockudos/next';
import { cn } from '@dockudos/ui';
import { run } from '@dockudos/cli';
if (parseConfig({ name: 'x' }).name !== 'x') throw new Error('core');
if (typeof loadConfig !== 'function') throw new Error('core/node');
if (!withDocs({}).pageExtensions.includes('mdx')) throw new Error('next');
if (cn('a', 'b') !== 'a b') throw new Error('ui');
if (typeof run !== 'function') throw new Error('cli');
console.log('smoke ok');
`,
  );
  // `withDocs()` validates docs.json when it is called, so a project needs one.
  writeFileSync(join(dir, 'docs.json'), JSON.stringify({ name: 'x' }));
  run('node', ['smoke.mjs']);
  console.log('OK: published packages install, typecheck and import');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
