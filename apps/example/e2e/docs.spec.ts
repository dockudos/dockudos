import { expect, test } from '@playwright/test';

test('renders docs/index.mdx at /', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome to Example Docs' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Home | Example Docs');
});

test('renders a nested page and follows links to it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'hello guide' }).click();
  await expect(page).toHaveURL('/guides/hello');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hello guide' }),
  ).toBeVisible();
});

test('returns 404 for a page that does not exist', async ({ page }) => {
  const response = await page.goto('/nope');
  expect(response?.status()).toBe(404);
});
