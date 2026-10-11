import { defineConfig } from '@playwright/test';

const port = 4310;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  webServer: [
    // An OpenID Connect provider for the login tests.
    {
      command: 'node e2e/mock-idp.mjs',
      url: 'http://127.0.0.1:4311/keys',
      reuseExistingServer: !process.env.CI,
    },
    // The static export, served by a plain file server.
    {
      command: 'node e2e/static-server.mjs',
      url: 'http://127.0.0.1:4312/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm exec next start -p ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      env: {
        DOCKUDOS_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
        SCALE_CLIENT_SECRET: 'e2e-secret',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /static\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'static',
      testMatch: /static\.spec\.ts/,
      use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4312' },
    },
  ],
});
