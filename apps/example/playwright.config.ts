import { defineConfig } from '@playwright/test';
import { API_KEY, LLM_KEY } from './e2e/constants';

const port = 4300;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  // Serves the production build; the `e2e` target builds first.
  webServer: [
    // A stand-in for the language model that `ai` in docs.json points at.
    {
      command: 'node e2e/fake-llm.mjs',
      url: 'http://127.0.0.1:4399/__calls',
      reuseExistingServer: !process.env.CI,
    },
    // The API the playground tries (4398), and one without CORS headers (4397).
    {
      command: 'node e2e/mock-api.mjs',
      url: 'http://127.0.0.1:4398/__calls',
      reuseExistingServer: !process.env.CI,
    },
    // A plain page on another origin, with the widget script in it: the "product" that embeds the assistant.
    {
      command: 'node e2e/host-page.mjs',
      url: 'http://127.0.0.1:4390',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm exec next start -p ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      // Secrets, only ever read from the environment: the `access` rules in docs.json, and the model's key.
      env: {
        DOCKUDOS_BASIC_AUTH: 'reader:s3cret-pass,editor:other-pass',
        DOCKUDOS_TOKEN: 'example-token-1234',
        DOCKUDOS_LLM_API_KEY: LLM_KEY,
        // For programs that call /api/ask themselves.
        DOCKUDOS_API_KEYS: API_KEY,
      },
    },
  ],
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
