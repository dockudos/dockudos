import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/platform',
  test: {
    name: '@dockudos/platform',
    watch: false,
    globals: true,
    // PGlite (a real Postgres in WASM) takes a second or two to start, longer when files run in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.{test,spec}.{ts,tsx}', '**/*.d.ts', 'src/lib/testing/**', 'src/server.ts'],
      // The bar for this package; `nx test-ci` fails below it.
      thresholds: { statements: 90, lines: 90 },
    },
  },
}));
