import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The built interface ships inside the CLI package (`dockudos edit` serves it).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: '../../packages/cli/editor',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    // `pnpm nx dev @dockudos/editor` with `dockudos edit` running: pass its port in EDITOR_API.
    proxy: process.env['EDITOR_API']
      ? {
          '/api': process.env['EDITOR_API'],
          '/media': process.env['EDITOR_API'],
        }
      : undefined,
  },
});
