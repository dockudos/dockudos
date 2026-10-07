import { convertPackageCommand } from './package-manager.ts';

describe('convertPackageCommand', () => {
  it('converts install with packages and -D', () => {
    expect(convertPackageCommand('npm install @dockudos/core -D')).toEqual({
      npm: 'npm install @dockudos/core -D',
      pnpm: 'pnpm add -D @dockudos/core',
      yarn: 'yarn add -D @dockudos/core',
      bun: 'bun add -d @dockudos/core',
    });
  });

  it('accepts the i alias and --save-dev', () => {
    expect(convertPackageCommand('npm i --save-dev vitest').pnpm).toBe(
      'pnpm add -D vitest',
    );
  });

  it('converts a bare install', () => {
    expect(convertPackageCommand('npm install')).toMatchObject({
      pnpm: 'pnpm install',
      yarn: 'yarn install',
      bun: 'bun install',
    });
  });

  it('handles global installs', () => {
    expect(convertPackageCommand('npm install -g dockudos')).toMatchObject({
      pnpm: 'pnpm add -g dockudos',
      yarn: 'yarn global add dockudos',
      bun: 'bun add -g dockudos',
    });
  });

  it('converts uninstall', () => {
    expect(convertPackageCommand('npm uninstall left-pad').yarn).toBe(
      'yarn remove left-pad',
    );
  });

  it('converts run scripts and keeps extra args', () => {
    expect(convertPackageCommand('npm run dev -- --port 4000')).toMatchObject({
      pnpm: 'pnpm run dev -- --port 4000',
      yarn: 'yarn dev -- --port 4000',
      bun: 'bun run dev -- --port 4000',
    });
  });

  it('converts npx', () => {
    expect(convertPackageCommand('npx dockudos init my-docs')).toEqual({
      npm: 'npx dockudos init my-docs',
      pnpm: 'pnpm dlx dockudos init my-docs',
      yarn: 'yarn dlx dockudos init my-docs',
      bun: 'bunx dockudos init my-docs',
    });
  });

  it('converts create and test/start/build', () => {
    expect(convertPackageCommand('npm create next-app').bun).toBe(
      'bun create next-app',
    );
    expect(convertPackageCommand('npm test').bun).toBe('bun run test');
    expect(convertPackageCommand('npm start').yarn).toBe('yarn start');
  });

  it('returns unknown commands unchanged for every manager', () => {
    expect(convertPackageCommand('git commit -m x')).toEqual({
      npm: 'git commit -m x',
      pnpm: 'git commit -m x',
      yarn: 'git commit -m x',
      bun: 'git commit -m x',
    });
    expect(convertPackageCommand('npm audit').pnpm).toBe('npm audit');
  });
});
