import { expect, test } from '@playwright/test';

// The static export (`dockudos build --static`), served by a plain file server: no API, no rewrites, no middleware.
test.describe('static export', () => {
  test('serves pages in every version and language as plain files', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scale Docs' }),
    ).toBeVisible();
    await page.goto('/fr/guides/auth/');
    await expect(page.locator('.dk-shell')).toHaveAttribute('lang', 'fr');
    await expect(page.getByText('marker-v2-fr')).toBeVisible();
    await page.goto('/v1/guides/auth/');
    await expect(page.locator('.dk-version-banner')).toBeVisible();
  });

  test('searches from the static index, inside the version and language of the page', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('rotate');
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const text = (await options.allTextContents()).join(' ');
    expect(text).toContain('Authentication');
    expect(text).not.toContain('thirty');
    await page.goto('/v1/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('rotate');
    await expect(options.first()).toBeVisible();
    expect((await options.allTextContents()).join(' ')).toContain('thirty');
  });

  test('has no AI or feedback buttons, and leaves out the private section', async ({
    page,
    request,
  }) => {
    await page.goto('/guides/auth/');
    await expect(page.getByRole('button', { name: /ask/i })).toHaveCount(0);
    await expect(page.locator('.dk-kudos')).toHaveCount(0);
    for (const path of [
      '/api/search/index',
      '/api/search/index-v2~en',
      '/llms-full.txt',
      '/guides/auth.md',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).not.toContain('SECRET-');
    }
    expect((await request.get('/team/handbook/')).status()).toBe(404);
  });

  test('writes the files that go with the pages', async ({ request }) => {
    expect(
      (await request.get('/og/guides/auth.png')).headers()['content-type'],
    ).toBe('image/png');
    expect((await request.get('/guides/auth.md')).status()).toBe(200);
    expect((await request.get('/fr/guides/auth.md')).status()).toBe(200);
    expect(await (await request.get('/sitemap.xml')).text()).toContain(
      '/fr/guides/auth',
    );
  });
});
