import { expect, test } from '@playwright/test';

test('renders docs/index.mdx at /', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome to Example Docs' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Example Docs');
});

test('renders a nested page and follows links to it', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('.dk-prose')
    .getByRole('link', { name: 'hello guide' })
    .click();
  await expect(page).toHaveURL('/guides/hello');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hello guide' }),
  ).toBeVisible();
});

test('returns 404 for a page that does not exist', async ({ page }) => {
  const response = await page.goto('/nope');
  expect(response?.status()).toBe(404);
});

test('redirects an old URL to the new one', async ({ page }) => {
  await page.goto('/old-hello');
  await expect(page).toHaveURL('/guides/hello');
});

test('serves a canonical URL and page description metadata', async ({
  page,
}) => {
  await page.goto('/guides/features');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://docs.example.com/guides/features',
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Admonitions, includes and links.',
  );
  await expect(page).toHaveTitle('Features | Example Docs');
});

test('serves sitemap.xml with absolute URLs', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('<loc>https://docs.example.com/</loc>');
  expect(xml).toContain('<loc>https://docs.example.com/guides/hello</loc>');
});

test('serves robots.txt pointing at the sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(await res.text()).toContain(
    'Sitemap: https://docs.example.com/sitemap.xml',
  );
});

test('compiles callouts, includes and page links', async ({ page }) => {
  await page.goto('/guides/features');
  await expect(page.locator('[data-callout="warning"]')).toContainText(
    'Careful',
  );
  await expect(page.getByText('included from')).toBeVisible();
  await page
    .locator('.dk-prose')
    .getByRole('link', { name: 'hello guide' })
    .click();
  await expect(page).toHaveURL('/guides/hello#first-steps');
});
