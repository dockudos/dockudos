import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  request as pwRequest,
  test,
  type Page,
} from '@playwright/test';

/**
 * Every screen of the dashboard that platform.spec.ts does not already walk through: connecting a repository, builds,
 * the docs agent, analytics settings, signing out and the signed-out state. These tests make their own team and site, so
 * they never change the seeded site the other file depends on.
 */
const API = 'http://127.0.0.1:4500';
const ORIGIN = 'http://localhost:4501';

/** The app's own alerts. Next adds an empty `role=alert` route announcer to every page. */
const alerts = (page: Page) => page.locator('.alert[role="alert"]');
const state = async () =>
  (
    await (await pwRequest.newContext()).get(`${API}/__e2e/state`)
  ).json() as Promise<any>;
const seedRepo = async (repo: string) =>
  (await pwRequest.newContext()).post(`${API}/__e2e/seed-repo`, {
    data: { repo },
  });

async function signIn(page: Page, to = '/') {
  await page.goto(
    `${API.replace('127.0.0.1', 'localhost')}/__e2e/login?returnTo=${encodeURIComponent(ORIGIN + to)}`,
  );
}

/** Connect `repo` as a new site through the team screen, the way a person would. Returns the site's id. */
async function connect(
  page: Page,
  repo: string,
  name: string,
): Promise<string> {
  const s = await state();
  await seedRepo(repo);
  await signIn(page, `/teams/${s.teamId}`);
  const form = page.locator('form', { hasText: 'Connect a repository' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Repository').fill(repo);
  await form.getByRole('button', { name: 'Connect' }).click();
  const link = page.getByRole('link', { name, exact: true });
  await expect(link).toBeVisible();
  return (await link.getAttribute('href'))!.split('/').pop()!;
}

test.describe('signed out', () => {
  test('the home page invites sign-in and offers nothing else', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Welcome to dockudos' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Sign in' }).first(),
    ).toHaveAttribute('href', '/auth/login?returnTo=/');
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your teams' })).toHaveCount(
      0,
    );
  });

  test('a protected screen says you are signed out instead of showing data', async ({
    page,
  }) => {
    const s = await state();
    for (const path of [
      `/sites/${s.siteId}`,
      `/sites/${s.siteId}/analytics`,
      `/teams/${s.teamId}`,
    ]) {
      await page.goto(path);
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'You are signed out' })
          .first(),
      ).toBeVisible();
      await expect(page.getByText('Acme Docs', { exact: true })).toHaveCount(0);
    }
  });

  test('the API behind it refuses anonymous requests with JSON, not a page', async ({
    request,
  }) => {
    const res = await request.get('/api/v1/me');
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  test('a change request without the dashboard origin is refused (CSRF)', async ({
    page,
    request,
  }) => {
    await signIn(page);
    const cookies = await page.context().cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const res = await request.post(`${API}/api/v1/teams`, {
      data: { name: 'Forged' },
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(res.status()).toBe(403);
    expect((await state()).teamId).toBeTruthy();
  });
});

test.describe('teams and sites', () => {
  test('a person creates a team, sees it with an empty state, and cannot create a blank one', async ({
    page,
  }) => {
    await signIn(page);
    const name = `Beta ${Date.now()}`;
    await page.getByLabel('New team').fill(name);
    await page.getByRole('button', { name: 'Create team' }).click();
    const card = page.locator('.card', {
      has: page.getByRole('link', { name, exact: true }),
    });
    await expect(card).toContainText('owner');
    await expect(card).toContainText('No sites yet');
    await expect(page.getByLabel('New team')).toHaveValue('');
    // The browser's own validation stops an empty name before any request is made.
    await page.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByLabel('New team')).toBeFocused();
    await expect(alerts(page)).toHaveCount(0);
  });

  test('connecting a repository shows the webhook once; an unreachable one explains itself', async ({
    page,
  }) => {
    const s = await state();
    await seedRepo('acme/connect-me');
    await signIn(page, `/teams/${s.teamId}`);
    const form = page.locator('form', { hasText: 'Connect a repository' });
    await form.getByLabel('Name').fill('Connect Me');
    await form.getByLabel('Repository').fill('acme/connect-me');
    await form.getByRole('button', { name: 'Connect' }).click();
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Add this webhook' });
    await expect(status).toBeVisible();
    await expect(status.locator('code').first()).toHaveText(
      /\/hooks\/github\/[0-9a-f-]{36}$/,
    );
    await expect(status.locator('code').nth(1)).toHaveText(/^[0-9a-f]{48}$/);
    await expect(
      page.getByRole('link', { name: 'Connect Me', exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel('Name')).toHaveValue('');

    await form.getByLabel('Name').fill('Ghost');
    await form.getByLabel('Repository').fill('acme/does-not-exist');
    await form.getByRole('button', { name: 'Connect' }).click();
    await expect(alerts(page)).toContainText(/could not be read|not found/i);
    await expect(
      page.getByRole('link', { name: 'Ghost', exact: true }),
    ).toHaveCount(0);

    await form.getByLabel('Name').fill('Same Again');
    await form.getByLabel('Repository').fill('acme/connect-me');
    await form.getByRole('button', { name: 'Connect' }).click();
    await expect(alerts(page)).toContainText('already connected');
  });

  test('signing out returns to the welcome page and drops access', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByText('Olivia Owner')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome to dockudos' }),
    ).toBeVisible();
    await expect(page.getByText('Olivia Owner')).toHaveCount(0);
    const res = await page.request.get('/api/v1/me');
    expect(res.status()).toBe(401);
  });
});

test.describe('builds', () => {
  test('rebuild, watch it finish, read its log, and rotate the webhook secret', async ({
    page,
  }) => {
    const repo = `acme/builds-${Date.now()}`;
    const id = await connect(page, repo, 'Builds Site');
    await page.goto(`/sites/${id}`);
    await expect(
      page.getByRole('heading', { name: 'Builds Site' }),
    ).toBeVisible();
    await expect(page.getByText('No builds yet.')).toBeVisible();
    await expect(page.getByText(new RegExp(`github:${repo}`))).toBeVisible();

    await page.getByRole('button', { name: 'Rebuild main' }).click();
    const row = page.getByRole('row').nth(1);
    await expect(row).toContainText('manual');
    // The worker runs in the background; refresh until it is done.
    await expect(async () => {
      if (await page.getByRole('button', { name: 'Refresh' }).count())
        await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(row).toContainText('succeeded', { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(row.getByText('live')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Log' }).click();
    await expect(page.getByLabel('Build log')).toContainText('Published');

    const first = await page
      .locator('p', { hasText: 'Webhook URL' })
      .locator('code')
      .textContent();
    expect(first).toMatch(/\/hooks\/github\//);
    await page.getByRole('button', { name: 'Rotate secret' }).click();
    const note = page
      .getByRole('status')
      .filter({ hasText: 'New webhook secret' });
    await expect(note.locator('code')).toHaveText(/^[0-9a-f]{48}$/);
  });

  test('the tabs lead to every section and mark the current one', async ({
    page,
  }) => {
    const s = await state();
    await signIn(page, `/sites/${s.siteId}`);
    const nav = page.getByRole('navigation', { name: 'Site sections' });
    await expect(nav.getByRole('link', { name: 'Builds' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const [name, suffix] of [
      ['Editor', '/editor'],
      ['Analytics', '/analytics'],
      ['Agent', '/agent'],
      ['Builds', ''],
    ] as const) {
      await nav.getByRole('link', { name }).click();
      await expect(page).toHaveURL(`${ORIGIN}/sites/${s.siteId}${suffix}`);
      await expect(nav.getByRole('link', { name })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('"Open site" points at the site\'s own address, never the dashboard', async ({
    page,
  }) => {
    const s = await state();
    await signIn(page, `/sites/${s.siteId}`);
    const open = page.getByRole('link', { name: 'Open site' });
    await expect(open).toHaveAttribute(
      'href',
      /^http:\/\/acme-docs\.sites\.localhost/,
    );
    await expect(open).toHaveAttribute('rel', 'noreferrer');
    await expect(open).toHaveAttribute('target', '_blank');
  });
});

test.describe('docs agent', () => {
  test('is off by default, warns that no model is set, and takes a code repository', async ({
    page,
  }) => {
    const id = await connect(page, `acme/agent-${Date.now()}`, 'Agent Site');
    await seedRepo('acme/code-one');
    await page.goto(`/sites/${id}/agent`);
    await expect(
      page.getByLabel('Turn the agent on for this site'),
    ).not.toBeChecked();
    await expect(
      page.getByText('No model is configured on this instance'),
    ).toBeVisible();

    await page.getByLabel('Turn the agent on for this site').click();
    await expect(
      page.getByLabel('Turn the agent on for this site'),
    ).toBeChecked();
    await page.reload();
    await expect(
      page.getByLabel('Turn the agent on for this site'),
    ).toBeChecked();

    await page.getByLabel('Repository').fill('acme/code-one');
    await page.getByRole('button', { name: 'Watch' }).click();
    await expect(page.getByText('github:acme/code-one')).toBeVisible();
    await expect(page.getByLabel('Repository')).toHaveValue('');

    await page.getByLabel('Repository').fill('not a repo name');
    await page.getByRole('button', { name: 'Watch' }).click();
    await expect(
      alerts(page).filter({ hasText: 'is not a repository name' }),
    ).toBeVisible();
    await expect(page.getByText('not a repo name')).toHaveCount(1); // only in the error, never listed

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('github:acme/code-one')).toHaveCount(0);
  });

  test('schedules checks, runs one now and shows the result in the runs table', async ({
    page,
  }) => {
    const id = await connect(page, `acme/auto-${Date.now()}`, 'Auto Site');
    await page.goto(`/sites/${id}/agent`);
    // Running anything needs the agent on.
    await page.getByRole('button', { name: 'Run now' }).first().click();
    await expect(alerts(page)).toContainText('Turn the agent on');
    await page.getByLabel('Turn the agent on for this site').click();
    await expect(
      page.getByLabel('Turn the agent on for this site'),
    ).toBeChecked();

    const links = page.locator('.row', { hasText: 'Broken links' });
    await links.getByRole('button', { name: 'Run weekly' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'broken-links will run weekly.',
    );
    await links.getByRole('button', { name: 'Off' }).click();
    await expect(page.getByRole('status')).toHaveText('broken-links is off.');

    // The site has no published build yet, so the run is recorded as failed, with the reason.
    await links.getByRole('button', { name: 'Run now' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Queued. Refresh in a moment.',
    );
    const runs = page.locator('section', { hasText: 'Runs' });
    await expect(async () => {
      await runs.getByRole('button', { name: 'Refresh' }).click();
      await expect(runs.getByRole('row').nth(1)).toContainText('failed', {
        timeout: 2000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(runs.getByRole('row').nth(1)).toContainText('broken-links');
    await expect(runs.getByRole('row').nth(1)).toContainText(
      'no published build',
    );

    await page
      .getByRole('button', { name: 'Check code repositories now' })
      .click();
    await expect(page.getByRole('status')).toHaveText(
      '0 code change(s) queued.',
    );
  });
});

test.describe('analytics settings', () => {
  test('conversation logging and retention are saved, survive a reload, and reject nonsense', async ({
    page,
  }) => {
    const id = await connect(page, `acme/stats-${Date.now()}`, 'Stats Site');
    await page.goto(`/sites/${id}/analytics`);
    await expect(
      page.getByRole('heading', { name: 'Top pages' }),
    ).toBeVisible();
    await expect(page.getByText('No views in this range.')).toBeVisible();
    await expect(
      page.getByText('Nothing here. Readers found what they searched for.'),
    ).toBeVisible();
    await expect(page.getByText('No feedback yet.')).toBeVisible();

    const keep = page.getByLabel('Keep assistant conversations');
    await expect(keep).not.toBeChecked();
    await keep.click();
    await expect(keep).toBeChecked();
    await expect(page.getByText('Turn on conversation logging')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Keep assistant conversations')).toBeChecked();

    const events = page.getByLabel('Keep events');
    await events.fill('30');
    await events.blur();
    await page.reload();
    await expect(page.getByLabel('Keep events')).toHaveValue('30');

    await page.getByLabel('Keep events').fill('0');
    await page.getByLabel('Keep events').blur();
    await expect(alerts(page)).toBeVisible();
  });

  test('a page view sent by a reader appears on the board, with no personal data in the page', async ({
    page,
    request,
  }) => {
    const id = await connect(page, `acme/beacon-${Date.now()}`, 'Beacon Site');
    const res = await request.post(`${API}/api/v1/ingest/${id}`, {
      data: { kind: 'pageview', path: '/hello' },
      headers: {
        'content-type': 'text/plain',
        'user-agent': 'Mozilla/5.0 Gecko Firefox/131',
      },
    });
    expect(res.status()).toBe(202);
    await page.goto(`/sites/${id}/analytics`);
    await expect(
      page.locator('section', { hasText: 'Top pages' }).getByRole('row').nth(1),
    ).toContainText('/hello');
    await expect(
      page.getByText('Page views (people)').locator('..').locator('.value'),
    ).toHaveText('1');
    expect(await page.content()).not.toMatch(/Firefox\/131|127\.0\.0\.1/);
  });
});

test.describe('security headers', () => {
  test('dashboard pages are not sniffable and do not leak the referrer', async ({
    request,
  }) => {
    const res = await request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('same-origin');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});

const screens = async () => {
  const s = await state();
  return [
    ['home', '/', 'Your teams'],
    ['team', `/teams/${s.teamId}`, 'API keys'],
    ['builds', `/sites/${s.siteId}`, 'Builds'],
    ['analytics', `/sites/${s.siteId}/analytics`, 'Top pages'],
    ['agent', `/sites/${s.siteId}/agent`, 'Docs agent'],
  ] as const;
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('the signed-out welcome page has no axe violations', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Welcome to dockudos' }),
      ).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });

    test('every signed-in screen has no axe violations', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const found: string[] = [];
      for (const [name, path, ready] of await screens()) {
        await signIn(page, path);
        await expect(
          page.getByRole('heading', { name: ready }).first(),
        ).toBeVisible();
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of results.violations)
          found.push(
            `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          );
      }
      expect(found).toEqual([]);
    });
  });
}

test.describe('keyboard', () => {
  test('the whole team form can be filled and submitted without a mouse', async ({
    page,
  }) => {
    const s = await state();
    await seedRepo('acme/keyboard');
    await signIn(page, `/teams/${s.teamId}`);
    await page
      .locator('form', { hasText: 'Connect a repository' })
      .getByLabel('Name')
      .focus();
    await page.keyboard.type('Keyboard Site');
    await page.keyboard.press('Tab'); // host
    await page.keyboard.press('Tab'); // repository
    await page.keyboard.type('acme/keyboard');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('link', { name: 'Keyboard Site', exact: true }),
    ).toBeVisible();
  });
});
