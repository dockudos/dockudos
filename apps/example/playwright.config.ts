import { defineConfig } from '@playwright/test';

const port = 4300;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  // Serves the production build; the `e2e` target builds first.
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // Secrets for the `access` rules in docs.json. They are only ever read from the environment.
    env: {
      DOCKUDOS_BASIC_AUTH: 'reader:s3cret-pass,editor:other-pass',
      DOCKUDOS_TOKEN: 'example-token-1234',
    },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /visual\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    // Screenshot baselines depend on the platform's fonts, so they live in
    // their own project: `pnpm nx e2e-visual @dockudos/example`.
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
});
