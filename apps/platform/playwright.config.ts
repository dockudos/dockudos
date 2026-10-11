import { defineConfig } from '@playwright/test';

const ui = 4501;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: { baseURL: `http://localhost:${ui}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    // The platform itself, with an in-process Postgres and an in-memory Git host.
    {
      command: 'node e2e/server.mjs',
      url: 'http://127.0.0.1:4500/healthz',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    // The dashboard, as built, talking to it through its own origin.
    {
      command: `pnpm exec next start -p ${ui}`,
      url: `http://localhost:${ui}`,
      reuseExistingServer: !process.env['CI'],
      env: { DOCKUDOS_API_URL: 'http://127.0.0.1:4500' },
    },
  ],
});
