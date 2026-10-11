import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/next',
  test: {
    name: '@dockudos/next',
    watch: false,
    // The first Shiki highlight loads grammars and themes.
    testTimeout: 30_000,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.{test,spec}.{ts,tsx}', '**/*.d.ts'],
      // The bar for this package; `nx test-ci` fails below it.
      thresholds: { statements: 98, lines: 98 },
    },
  },
}));
