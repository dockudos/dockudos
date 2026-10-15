import { expect, test, type Page } from '@playwright/test';

/**
 * What every dashboard screen looks like, in light and dark and on a phone. The screens are the real application; only
 * the API is replaced with fixed answers, so a picture changes when the UI changes, never because the backend's data (or
 * the order the other specs ran in) did. Time zone and locale are pinned so dates print the same everywhere.
 *
 * Update the pictures after an intended change with: pnpm nx e2e @dockudos/platform-app -- e2e/visual.spec.ts --update-snapshots
 */
const SITE = 's-1';
const TEAM = 't-1';
const at = (iso: string) => iso;

const ME = {
  type: 'user',
  user: { id: 'u-1', email: 'olivia@acme.test', name: 'Olivia Owner' },
  teams: [{ id: TEAM, name: 'Acme', slug: 'acme', role: 'owner' }],
};
const SITE_ROW = {
  id: SITE,
  name: 'Acme Docs',
  slug: 'acme-docs',
  repo: 'acme/docs',
  provider: 'github',
  teamId: TEAM,
  defaultBranch: 'main',
  liveBuildId: 'b-3',
};
const BUILDS = [
  ['b-4', 'running', 'push', 'a1b2c3d4e5f6', null],
  ['b-3', 'succeeded', 'push', '9f8e7d6c5b4a', null],
  [
    'b-2',
    'failed',
    'manual-1',
    '0a1b2c3d4e5f',
    'npm run build failed (exit 1).',
  ],
  ['b-1', 'succeeded', 'manual-0', '1234567890ab', null],
].map(([id, status, trigger, commitSha, error], i) => ({
  id,
  status,
  trigger,
  commitSha,
  ...(error && { error }),
  createdAt: at(`2026-03-0${4 - i}T10:00:00Z`),
}));
const BOARD = {
  range: { from: '2026-02-03', to: '2026-03-04' },
  series: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-02-${String(i + 1).padStart(2, '0')}`,
    views: 10 + ((i * 7) % 23),
    visitors: 5 + ((i * 3) % 11),
  })),
  traffic: { human: 480, ai: 62, bot: 17 },
  aiAgents: [
    { agent: 'OpenAI', views: 40 },
    { agent: 'Anthropic', views: 22 },
  ],
  topPages: [
    { path: '/guides/webhooks', views: 210, visitors: 120 },
    { path: '/', views: 170, visitors: 140 },
    { path: '/quickstart', views: 98, visitors: 80 },
  ],
  topSearches: [{ query: 'webhooks', searches: 31 }],
  failedSearches: [
    { query: 'webhook retries', searches: 9 },
    { query: 'sso', searches: 4 },
  ],
  feedback: [{ path: '/guides/webhooks', up: 12, down: 3 }],
  assistant: { answered: 41, unanswered: 6, unansweredTopics: null },
  referrers: [
    { host: 'news.example', views: 55 },
    { host: 'search.example', views: 120 },
  ],
};
const RUNS = [
  {
    id: 'r-2',
    trigger: 'code-change',
    status: 'opened',
    codeRepo: 'acme/api',
    prUrl: 'https://github.com/acme/docs/pull/7',
    flagged: [
      { path: '/guides/webhooks', reasons: [], outcome: 'edit proposed' },
    ],
    createdAt: at('2026-03-04T09:00:00Z'),
  },
  {
    id: 'r-1',
    trigger: 'broken-links',
    status: 'flagged',
    flagged: [{ path: '/guides/auth', reasons: [], outcome: 'needs a person' }],
    createdAt: at('2026-03-03T09:00:00Z'),
  },
];

const ANSWERS: Record<string, unknown> = {
  '/api/v1/me': ME,
  [`/api/v1/teams/${TEAM}/sites`]: { sites: [SITE_ROW] },
  [`/api/v1/teams/${TEAM}/members`]: {
    members: [
      {
        userId: 'u-1',
        email: 'olivia@acme.test',
        name: 'Olivia Owner',
        role: 'owner',
      },
      { userId: 'u-2', email: 'sam@acme.test', role: 'editor' },
    ],
  },
  [`/api/v1/teams/${TEAM}/keys`]: {
    keys: [
      {
        id: 'k-1',
        name: 'CI deploys',
        prefix: 'ab12cd34',
        role: 'editor',
        createdAt: at('2026-02-01T00:00:00Z'),
        lastUsedAt: at('2026-03-01T08:30:00Z'),
      },
      {
        id: 'k-2',
        name: 'Old key',
        prefix: 'ff00ee11',
        role: 'viewer',
        createdAt: at('2026-01-01T00:00:00Z'),
        revokedAt: at('2026-02-10T00:00:00Z'),
      },
    ],
  },
  [`/api/v1/sites/${SITE}`]: {
    site: SITE_ROW,
    webhookUrl: 'https://platform.example.com/hooks/github/s-1',
    url: 'https://acme-docs.sites.example.com',
  },
  [`/api/v1/sites/${SITE}/builds`]: { builds: BUILDS },
  [`/api/v1/sites/${SITE}/analytics`]: BOARD,
  [`/api/v1/sites/${SITE}/analytics/settings`]: {
    logConversations: false,
    conversationRetentionDays: 30,
    retentionDays: 90,
  },
  [`/api/v1/sites/${SITE}/agent`]: {
    enabled: true,
    codeRepos: [{ provider: 'github', repo: 'acme/api' }],
    modelConfigured: false,
  },
  [`/api/v1/sites/${SITE}/agent/runs`]: { runs: RUNS },
};

async function stubApi(page: Page, signedIn = true) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!signedIn)
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'unauthorized', message: 'Sign in to continue.' },
        }),
      });
    const body = ANSWERS[path];
    return route.fulfill(
      body === undefined
        ? {
            status: 404,
            contentType: 'application/json',
            body: '{"error":{"code":"not_found","message":"Not found."}}',
          }
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          },
    );
  });
}

const screens = [
  ['home', '/', 'Your teams'],
  ['team', `/teams/${TEAM}`, 'API keys'],
  ['builds', `/sites/${SITE}`, 'Builds'],
  ['analytics', `/sites/${SITE}/analytics`, 'Top pages'],
  ['agent', `/sites/${SITE}/agent`, 'Runs'],
] as const;

const viewports = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

for (const scheme of ['light', 'dark'] as const) {
  for (const [vp, size] of Object.entries(viewports)) {
    test.describe(`${scheme} ${vp}`, () => {
      test.use({
        colorScheme: scheme,
        viewport: size,
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
      });

      test('signed out', async ({ page }) => {
        await stubApi(page, false);
        await page.goto('/');
        await expect(
          page.getByRole('heading', { name: 'Welcome to dockudos' }),
        ).toBeVisible();
        await expect(page).toHaveScreenshot(`welcome-${scheme}-${vp}.png`, {
          fullPage: true,
        });
      });

      for (const [name, path, ready] of screens) {
        test(name, async ({ page }) => {
          await stubApi(page);
          await page.goto(path);
          await expect(
            page.getByRole('heading', { name: ready }).first(),
          ).toBeVisible();
          await page.waitForLoadState('networkidle');
          await expect(page).toHaveScreenshot(`${name}-${scheme}-${vp}.png`, {
            fullPage: true,
          });
        });
      }
    });
  }
}

test.describe('states that only show up in use', () => {
  test.use({
    colorScheme: 'light',
    viewport: viewports.desktop,
    timezoneId: 'UTC',
    locale: 'en-US',
  });

  test('an error from the API is shown as an alert, not as a blank page', async ({
    page,
  }) => {
    await page.route('**/api/v1/**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal', message: 'Something went wrong.' },
        }),
      }),
    );
    await page.goto(`/sites/${SITE}`);
    await expect(page.locator('.alert.error').first()).toHaveText(
      'Something went wrong.',
    );
    await expect(page).toHaveScreenshot('error-alert.png', { fullPage: true });
  });

  test('a site with nothing built or watched yet', async ({ page }) => {
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const empty: Record<string, unknown> = {
        ...ANSWERS,
        [`/api/v1/sites/${SITE}`]: {
          ...(ANSWERS[`/api/v1/sites/${SITE}`] as object),
          site: { ...SITE_ROW, liveBuildId: undefined },
        },
        [`/api/v1/sites/${SITE}/builds`]: { builds: [] },
        [`/api/v1/sites/${SITE}/agent`]: {
          enabled: false,
          codeRepos: [],
          modelConfigured: true,
        },
        [`/api/v1/sites/${SITE}/agent/runs`]: { runs: [] },
      };
      return route.fulfill({
        status: empty[path] ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(empty[path] ?? {}),
      });
    });
    await page.goto(`/sites/${SITE}`);
    await expect(page.getByText('No builds yet.')).toBeVisible();
    await expect(page).toHaveScreenshot('builds-empty.png', { fullPage: true });
    await page.goto(`/sites/${SITE}/agent`);
    await expect(
      page.getByLabel('Turn the agent on for this site'),
    ).not.toBeChecked();
    await expect(page.getByText('No model is configured')).toHaveCount(0);
    await expect(page).toHaveScreenshot('agent-empty.png', { fullPage: true });
  });
});
