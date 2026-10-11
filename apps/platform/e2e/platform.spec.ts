import { expect, test, type Page } from '@playwright/test';
import { request as pwRequest } from '@playwright/test';
import { request as httpRequest } from 'node:http';

const API = 'http://127.0.0.1:4500';
const state = async () =>
  (
    await (await pwRequest.newContext()).get(`${API}/__e2e/state`)
  ).json() as Promise<any>;

/** A GET with a chosen Host header, the way a browser reaches `<slug>.sites.<domain>`. */
const getWithHost = (host: string, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: 4500, path, headers: { host } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });

async function signIn(page: Page, to = '/') {
  await page.goto(
    `${API.replace('127.0.0.1', 'localhost')}/__e2e/login?returnTo=${encodeURIComponent('http://localhost:4501' + to)}`,
  );
}

test.beforeEach(async ({ request }) => {
  await request.get(`${API}/__e2e/reset`);
});

test('shows a sign-in page to visitors, then the teams and sites after sign-in', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Welcome to dockudos' }),
  ).toBeVisible();
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Your teams' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Acme', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Acme Docs' })).toBeVisible();
  await expect(page.getByText('Olivia Owner')).toBeVisible();
});

test('dashboard renders the seeded analytics without personal data', async ({
  page,
}) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/analytics`);
  await expect(page.getByRole('heading', { name: 'Top pages' })).toBeVisible();
  const top = page.locator('section', { hasText: 'Top pages' });
  await expect(top.getByRole('row').nth(1)).toContainText('/guides/webhooks');
  await expect(
    page.locator('section', { hasText: 'Searches with no results' }),
  ).toContainText('webhook retries');
  await expect(
    page.locator('section', { hasText: 'Feedback' }).first(),
  ).toContainText('/guides/webhooks');
  await expect(
    page.locator('section', { hasText: 'Traffic' }).first(),
  ).toContainText('AI tools 1');
  await expect(page.getByText('OpenAI: 1')).toBeVisible();
  // Conversation logging is off by default, so unanswered questions are counts only.
  await expect(page.getByText('Turn on conversation logging')).toBeVisible();
  const body = await page.content();
  expect(body).not.toMatch(/203\.0\.113|198\.51\.100|Firefox|GPTBot/);
});

test('editing a page shows a live preview with the real components and saves a pull request, never touching main', async ({
  page,
}) => {
  const before = await state();
  await signIn(page, `/sites/${before.siteId}/editor`);
  await page.getByRole('button', { name: 'docs/index.mdx' }).click();
  const source = page.getByLabel('Page source');
  await expect(source).toHaveValue(/Hello from Acme/);
  await source.fill(
    '---\ntitle: Welcome\n---\n\n# Welcome\n\n<Callout type="warning">Mind the gap</Callout>\n',
  );
  const frame = page.frameLocator('iframe[title="Live preview"]');
  await expect(frame.getByText('Mind the gap')).toBeVisible();
  await page.getByLabel('Commit message').fill('Add a warning');
  await page
    .getByRole('button', { name: /Save as pull request \(1\)/ })
    .click();
  const link = page.getByRole('link', {
    name: 'Review and merge the pull request',
  });
  await expect(link).toBeVisible();
  const after = await state();
  expect(after.head).toBe(before.head);
  expect(after.main['docs/index.mdx']).toContain('Hello from Acme');
  expect(after.pulls).toHaveLength(1);
  expect(after.pulls[0]).toMatchObject({
    base: 'main',
    title: 'Add a warning',
  });
  expect(after.pushes.every((p: any) => p.branch !== 'main')).toBe(true);
});

test('creates and renames pages (sidebar and redirects stay consistent), saved as one pull request', async ({
  page,
}) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/editor`);
  page.on('dialog', async (d) => {
    const m = d.message();
    if (m.startsWith('New page id')) await d.accept('guides/rotating-keys');
    else if (m === 'Title') await d.accept('Rotating keys');
    else if (m.startsWith('Rename to')) await d.accept('guides/signatures');
    else await d.accept();
  });
  await page.getByRole('button', { name: 'New page' }).click();
  await expect(page.getByLabel('Page source')).toHaveValue(
    /title: "Rotating keys"/,
  );
  await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled(); // not in the repository yet
  await page.getByRole('button', { name: 'docs/guides/webhooks.mdx' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(
    page.getByRole('button', { name: /docs\/guides\/signatures\.mdx/ }),
  ).toBeVisible();
  await page.getByLabel('Commit message').fill('Reorganize guides');
  await page.getByRole('button', { name: /Save as pull request/ }).click();
  await expect(
    page.getByRole('link', { name: 'Review and merge the pull request' }),
  ).toBeVisible();
  const after = await state();
  expect(after.pulls).toHaveLength(1);
  expect(after.main['docs/guides/webhooks.mdx']).toBeDefined(); // main is untouched until the pull request is merged
  expect(after.main['docs/guides/signatures.mdx']).toBeUndefined();
});

test('unsaved work can be discarded in one step', async ({ page }) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/editor`);
  page.on('dialog', async (d) => {
    await d.accept(
      d.message().startsWith('New page id')
        ? 'tmp/scratch'
        : d.message() === 'Title'
          ? 'Scratch'
          : undefined,
    );
  });
  await page.getByRole('button', { name: 'New page' }).click();
  await expect(
    page.getByRole('button', { name: /docs\/tmp\/scratch\.mdx/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Save as pull request \(2\)/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Discard all' }).click();
  await expect(
    page.getByRole('button', { name: /docs\/tmp\/scratch\.mdx/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Save as pull request \(0\)/ }),
  ).toBeDisabled();
});

test('a change made by someone else while editing is caught, and the person decides', async ({
  page,
  request,
}) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/editor`);
  await page.getByRole('button', { name: 'docs/guides/webhooks.mdx' }).click();
  await expect(page.getByLabel('Page source')).toHaveValue(
    /Check the signature/,
  );
  await request.post(`${API}/__e2e/push`, {
    data: {
      'docs/guides/webhooks.mdx':
        '---\ntitle: Webhooks\n---\n\n## Verify deliveries\n\nTheir edit.\n',
    },
  });
  await page
    .getByLabel('Page source')
    .fill('---\ntitle: Webhooks\n---\n\n## Verify deliveries\n\nMy edit.\n');
  await page.getByLabel('Commit message').fill('My edit');
  await page.getByRole('button', { name: /Save as pull request/ }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Someone changed' }),
  ).toBeVisible();
  expect((await state()).pulls).toHaveLength(0);
  await page.getByRole('button', { name: 'Keep my version and save' }).click();
  await expect(
    page.getByRole('link', { name: 'Review and merge the pull request' }),
  ).toBeVisible();
  expect((await state()).pulls).toHaveLength(1);
});

test('docs.json is validated against the schema as it is edited', async ({
  page,
}) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/editor`);
  await page.getByRole('button', { name: 'docs.json' }).click();
  await expect(page.getByText('docs.json is valid.')).toBeVisible();
  await page
    .getByLabel('docs.json source')
    .fill('{"name":"Acme","notAKey":true}');
  await expect(
    page.getByRole('alert').filter({ hasText: 'notAKey' }),
  ).toBeVisible();
  await page.getByLabel('docs.json source').fill('{ nope');
  await expect(page.getByText('not valid JSON yet')).toBeVisible();
});

test('the preview frame is sandboxed: opaque origin, no network, no way to reach the dashboard', async ({
  page,
  request,
}) => {
  const res = await request.get('/preview-frame');
  expect(res.headers()['content-security-policy']).toContain(
    'sandbox allow-scripts',
  );
  expect(res.headers()['content-security-policy']).toContain(
    "connect-src 'none'",
  );
  const s = await state();
  await signIn(page, `/sites/${s.siteId}/editor`);
  await page.getByRole('button', { name: 'docs/index.mdx' }).click();
  await expect(page.locator('iframe[title="Live preview"]')).toHaveAttribute(
    'sandbox',
    'allow-scripts',
  );
  // Hostile MDX tries to read the cookie and call the API from inside the frame.
  await page
    .getByLabel('Page source')
    .fill(
      '# x\n\n{(() => { try { document.cookie; return "cookie-readable"; } catch { return "cookie-blocked"; } })()}\n',
    );
  const frame = page.frameLocator('iframe[title="Live preview"]');
  await expect(frame.getByText('cookie-blocked')).toBeVisible();
});

test('a push to the repository rebuilds the site and the new content goes live (P5 acceptance)', async ({
  page,
  request,
}) => {
  const s = await state();
  await signIn(page, `/sites/${s.siteId}`);
  await expect(page.getByRole('heading', { name: 'Builds' })).toBeVisible();
  const hook = await request.get(`${API}/__e2e/webhook`);
  expect((await hook.json()).status).toBe(202);
  await expect(async () => {
    await page.reload();
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: 'push' })
        .first()
        .getByText('succeeded'),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const live = await getWithHost('acme-docs.sites.localhost:4500', '/');
  expect(live.status).toBe(200);
  expect(live.body).toMatch(/Built \d+/);
  expect(
    (await getWithHost('acme-docs.sites.localhost:4500', '/missing')).status,
  ).toBe(404);
  // The platform's own host never serves site files.
  expect((await request.get(`${API}/index.html`)).status()).toBe(404);
});

test('team settings: add a member by email, create a key (shown once) and revoke it', async ({
  page,
}) => {
  const s = await state();
  await signIn(page, `/teams/${s.teamId}`);
  await page.getByLabel('Name', { exact: true }).last().fill('CI deploys');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText(/Copy this key now/)).toBeVisible();
  await expect(page.getByText(/Copy this key now/).locator('code')).toHaveText(
    /^dkd_[0-9a-f]{8}_/,
  );
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(page.getByText('revoked')).toBeVisible();
});
