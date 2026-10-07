#!/usr/bin/env node
// The end-to-end proof for `dockudos init`: from a registry (default: the local
// Verdaccio), run `npx dockudos init`, install, build, and check the output.
//
//   pnpm nx local-registry                                       # terminal 1
//   pnpm nx release publish --registry http://localhost:4873/    # after building
//   pnpm verify:init                                             # terminal 2
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = process.env.REGISTRY ?? 'http://localhost:4873/';
const dir = mkdtempSync(join(tmpdir(), 'dockudos-init-'));
const site = join(dir, 'my-docs');
const sh = (cmd, args, cwd = dir) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });

const started = Date.now();
try {
  // Isolated npm config: this registry for everything, so nothing leaks in from the user's setup.
  writeFileSync(join(dir, '.npmrc'), `registry=${registry}\n`);
  sh('npx', ['--yes', '--registry', registry, '@dockudos/cli', 'init', 'my-docs', '--yes', '--package-manager', 'npm']);
  writeFileSync(join(site, '.npmrc'), `registry=${registry}\n`);

  sh('npm', ['install', '--no-audit', '--no-fund'], site);
  sh('npm', ['run', 'build'], site);

  const must = (file) => {
    if (!existsSync(join(site, file))) throw new Error(`expected ${file} after the build`);
  };
  must('.next/BUILD_ID');
  must('.next/server/app/index.html');
  must('.next/server/app/quickstart.html');
  const home = readFileSync(join(site, '.next/server/app/index.html'), 'utf8');
  if (!home.includes('Welcome to My Docs')) throw new Error('home page is missing its title');

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`OK: init, install and build took ${seconds}s`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
