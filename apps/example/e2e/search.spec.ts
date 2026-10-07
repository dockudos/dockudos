import { expect, test } from '@playwright/test';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('search', () => {
  test('finds text inside a page and opens the section', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    const box = page.getByRole('combobox', { name: 'Search pages' });
    await box.fill('write some MDX');
    const option = page.getByRole('option').first();
    await expect(option).toContainText('Hello guide › First steps');
    await expect(option.locator('mark').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/guides/hello#first-steps');
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });

  test('forgives typos and matches the word being typed', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    const box = page.getByRole('combobox');
    await box.fill('pakage managrs');
    await expect(page.getByRole('option').first()).toContainText(
      'Package managers',
    );
    await box.fill('compon');
    await expect(page.getByRole('option').first()).toContainText('Components');
  });

  test('never finds hidden or protected pages', async ({ page, request }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('Quokka');
    await expect(page.getByText(/No results for/)).toBeVisible();
    await expect(
      page.getByRole('option').filter({ hasNotText: /Ask AI|Take me there/ }),
    ).toHaveCount(0);

    const index = await request.get('/api/search/index');
    expect(index.status()).toBe(200);
    const text = await index.text();
    expect(text).not.toMatch(/Top secret plan|Quokka/);
    expect(text).not.toContain('"/private');
    const body = await (await request.get('/api/search?q=Quokka')).json();
    expect(JSON.stringify(body)).not.toContain('private');
  });

  test('serves the index with caching headers and the server search route', async ({
    request,
  }) => {
    const index = await request.get('/api/search/index');
    expect(index.headers()['cache-control']).toContain('max-age');
    const etag = index.headers()['etag'];
    expect(etag).toBeTruthy();
    const again = await request.get('/api/search/index', {
      headers: { 'if-none-match': etag as string },
    });
    expect(again.status()).toBe(304);

    const hits = await (await request.get('/api/search?q=first+steps')).json();
    expect(hits.hits[0].url).toBe('/guides/hello#first-steps');
    expect(
      (await request.get(`/api/search?q=${'x'.repeat(400)}`)).status(),
    ).toBe(400);
  });

  test('page text for tools', async ({ request }) => {
    const res = await request.get('/api/page?path=/guides/hello');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Hello guide');
    expect(body.markdown).toContain('Install the packages and write some MDX.');
    expect(
      (await request.get('/api/page?path=/private/secret')).status(),
    ).not.toBe(200);
  });
});
