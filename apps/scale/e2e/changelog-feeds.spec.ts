import { expect, test } from '@playwright/test';

test.describe('changelog, feeds and cards', () => {
  test('filters the changelog by tag', async ({ page }) => {
    await page.goto('/changelog');
    await expect(page.getByRole('heading', { name: '2.0.0' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1.9.0' })).toBeVisible();
    await page.getByRole('button', { name: 'Fixed' }).click();
    await expect(page.getByRole('heading', { name: '2.0.0' })).toBeHidden();
    await expect(page.getByRole('heading', { name: '1.9.0' })).toBeVisible();
    await page.getByRole('button', { name: 'Fixed' }).click();
    await expect(page.getByRole('heading', { name: '2.0.0' })).toBeVisible();
  });

  test('serves a valid RSS 2.0 changelog feed whose items link to their entries', async ({
    request,
    page,
  }) => {
    const res = await request.get('/changelog.xml');
    expect(res.headers()['content-type']).toContain('application/rss+xml');
    const xml = await res.text();
    // parsed by the browser's own XML parser: well-formed, with the elements RSS 2.0 requires
    await page.setContent('<p>parse</p>');
    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror'))
        return { error: doc.querySelector('parsererror')?.textContent };
      const channel = doc.querySelector('rss > channel');
      const items = [...doc.querySelectorAll('item')].map((i) => ({
        title: i.querySelector('title')?.textContent,
        link: i.querySelector('link')?.textContent,
        guid: i.querySelector('guid')?.textContent,
        pubDate: i.querySelector('pubDate')?.textContent,
        categories: [...i.querySelectorAll('category')].map(
          (c) => c.textContent,
        ),
      }));
      return {
        version: doc.documentElement.getAttribute('version'),
        title: channel?.querySelector(':scope > title')?.textContent,
        link: channel?.querySelector(':scope > link')?.textContent,
        description: channel?.querySelector(':scope > description')
          ?.textContent,
        items,
      };
    }, xml);
    expect(parsed).toMatchObject({
      version: '2.0',
      title: 'Scale Docs changelog',
    });
    expect((parsed as { items: unknown[] }).items).toEqual([
      expect.objectContaining({
        title: '2.0.0',
        link: 'http://localhost:4310/changelog#2-0-0',
        categories: ['Added', 'Breaking'],
        pubDate: 'Tue, 31 Mar 2026 00:00:00 GMT',
      }),
      expect.objectContaining({
        title: '1.9.0',
        link: 'http://localhost:4310/changelog#1-9-0',
      }),
    ]);
    // the link goes to a real element of the page
    await page.goto('/changelog#2-0-0');
    await expect(page.locator('[id="2-0-0"]')).toBeVisible();
    // pages announce the feed
    const home = await (await request.get('/')).text();
    expect(home).toMatch(
      /<link rel="alternate"[^>]*type="application\/rss\+xml"/,
    );
  });

  test('serves a feed of dated pages', async ({ request }) => {
    const xml = await (await request.get('/rss.xml')).text();
    expect(xml).toContain('<title>Scale 2 is out</title>');
    expect(xml).not.toContain('Team handbook');
  });

  test('gives every page a social card', async ({ request }) => {
    const html = await (await request.get('/guides/auth')).text();
    expect(html).toContain(
      'property="og:image" content="http://localhost:4310/og/guides/auth.png"',
    );
    const png = await request.get('/og/guides/auth.png');
    expect(png.headers()['content-type']).toBe('image/png');
    expect((await png.body()).subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  test('sends feedback to the page route', async ({ page }) => {
    await page.goto('/guides/auth');
    const posted = page.waitForResponse(
      (r) => r.url().endsWith('/api/kudos') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Yes' }).click();
    expect((await posted).status()).toBe(201);
    await expect(page.getByRole('button', { name: 'Yes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
