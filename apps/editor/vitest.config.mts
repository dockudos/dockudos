import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/editor',
  plugins: [react()],
  test: {
    name: '@dockudos/editor',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    reporters: ['default'],
    // The corpus tests parse every page of the docs; a busy CI machine needs more than the 5 s default.
    testTimeout: 60_000,
  },
}));
