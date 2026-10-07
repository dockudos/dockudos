import { expect, test } from '@playwright/test';

test.describe('the whole site as one document', () => {
  // /print is protected in this site (see docs.json), so the book is read with credentials.
  test.use({
    httpCredentials: { username: 'reader', password: 's3cret-pass' },
  });

  test('has a cover, a contents list and every visible page, in navigation order', async ({
    page,
  }) => {
    await page.goto('/print');
    await expect(page.locator('body[data-book-ready="1"]')).toBeAttached();
    await expect(page.locator('.dk-book-title')).toHaveText('Example Docs');

    const sections = await page
      .locator('[data-book-path]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset['bookPath']),
      );
    expect(sections.slice(0, 5)).toEqual([
      '/',
      '/guides/hello',
      '/guides/features',
      '/guides/components',
      '/guides/code',
    ]);
    // Hidden pages (the layout fixtures) are not in the book.
    expect(sections.some((p) => p?.startsWith('/layouts/'))).toBe(false);
    // The book itself is behind credentials, so it holds the protected page too.
    expect(sections).toContain('/private/secret');
    // Partials are not pages either.
    expect(sections.some((p) => p?.includes('snippets'))).toBe(false);

    const toc = page.getByRole('navigation', { name: 'Contents' });
    await expect(
      toc.getByRole('link', { name: 'Hello guide' }),
    ).toHaveAttribute('href', '#doc-guides-hello');
  });

  test('every page starts on a new sheet when printed, and the site chrome is gone', async ({
    page,
  }) => {
    await page.goto('/print');
    await page.emulateMedia({ media: 'print' });
    const breaks = await page
      .locator('.dk-book-page')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).breakBefore));
    expect(new Set(breaks)).toEqual(new Set(['page']));
    await expect(page.locator('.dk-navbar')).toHaveCount(0);
    await expect(page.locator('.dk-kudos')).toHaveCount(0);
  });

  test('links between pages stay inside the document and heading ids do not collide', async ({
    page,
  }) => {
    await page.goto('/print');
    await expect(page.locator('body[data-book-ready="1"]')).toBeAttached();
    // index.mdx links to /guides/hello; features.mdx links to ./hello.mdx#first-steps.
    await expect(
      page.locator('#doc-home .dk-prose a[href="#doc-guides-hello"]'),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '#doc-guides-features .dk-prose a[href="#doc-guides-hello--first-steps"]',
      ),
    ).toHaveCount(1);
    await expect(page.locator('#doc-guides-hello--first-steps')).toBeAttached();

    const ids = await page
      .locator('[id]')
      .evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);

    await page
      .locator('#doc-home .dk-prose a[href="#doc-guides-hello"]')
      .click();
    await expect(page).toHaveURL(/#doc-guides-hello$/);
    await expect(page.locator('#doc-guides-hello')).toBeInViewport();
  });

  test('prints to a single PDF with one page per sheet or more, and a cover first', async ({
    page,
  }) => {
    await page.goto('/print');
    await expect(page.locator('body[data-book-ready="1"]')).toBeAttached();
    const pages = await page.locator('[data-book-path]').count();
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      outline: true,
      tagged: true,
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const sheets = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [])
      .length;
    // Cover, contents, and at least one sheet for each page.
    expect(sheets).toBeGreaterThanOrEqual(pages + 2);
  });

  test('is not indexed and not part of the sitemap', async ({
    page,
    request,
  }) => {
    await page.goto('/print');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain(
      '/print',
    );
  });
});
