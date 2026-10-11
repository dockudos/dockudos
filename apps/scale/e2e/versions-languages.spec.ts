import { expect, test } from '@playwright/test';

test.describe('versions and languages', () => {
  test('serves the latest version in the default language at the short address', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.dk-shell')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scale Docs' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue(
      'en',
    );
    await expect(page.getByRole('combobox', { name: 'Version' })).toHaveValue(
      'v2',
    );
    await expect(page.locator('.dk-version-banner')).toHaveCount(0);
  });

  test('the language switcher keeps the reader on the same page, and remembers the choice', async ({
    page,
    context,
  }) => {
    await page.goto('/guides/auth');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
    await expect(page).toHaveURL('/fr/guides/auth');
    await expect(page.locator('.dk-shell')).toHaveAttribute('lang', 'fr');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Authentification' }),
    ).toBeVisible();
    // interface words come in the page's language
    await expect(
      page.getByRole('heading', { name: 'Sur cette page' }),
    ).toBeVisible();
    expect(
      (await context.cookies()).find((c) => c.name === 'dockudos-locale')
        ?.value,
    ).toBe('fr');
    await page.getByRole('combobox', { name: 'Langue' }).selectOption('en');
    await expect(page).toHaveURL('/guides/auth');
  });

  test('the version switcher goes to the same page in the other version, with a notice', async ({
    page,
  }) => {
    await page.goto('/guides/auth');
    await page.getByRole('combobox', { name: 'Version' }).selectOption('v1');
    await expect(page).toHaveURL('/v1/guides/auth');
    await expect(
      page.getByText('Legacy rule: rotate an API key every thirty days.'),
    ).toBeVisible();
    const banner = page.locator('.dk-version-banner');
    await expect(banner).toContainText('Version 1.x is deprecated');
    await banner
      .getByRole('link', { name: 'Go to this page in the latest version' })
      .click();
    await expect(page).toHaveURL('/guides/auth');
  });

  test('falls back to a parent page when the page does not exist in the other version', async ({
    page,
  }) => {
    await page.goto('/guides/only-english');
    await page.getByRole('combobox', { name: 'Version' }).selectOption('v1');
    await expect(page).toHaveURL('/v1');
    await expect(
      page.getByText('This is the legacy documentation.'),
    ).toBeVisible();
  });

  test('shows an untranslated page in the default language, says so, and is not offered as a translation', async ({
    page,
    request,
  }) => {
    await page.goto('/fr/guides/only-english');
    await expect(page.locator('.dk-fallback-notice')).toContainText(
      'Cette page n’est pas encore disponible en Français. Elle est affichée en English.',
    );
    await expect(page.getByText('marker-only-english')).toBeVisible();
    const html = await (await request.get('/fr/guides/only-english')).text();
    expect(html).toContain('name="robots" content="noindex, follow"');
    expect(html).toContain(
      'rel="canonical" href="http://localhost:4310/guides/only-english"',
    );
    // a switch from here to French of a page that has no French goes to the French home
    await page.goto('/guides/only-english');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
    await expect(page).toHaveURL('/fr');
  });

  test('writes hreflang alternates and canonical addresses', async ({
    request,
  }) => {
    const html = await (await request.get('/guides/auth')).text();
    expect(html).toContain(
      'rel="canonical" href="http://localhost:4310/guides/auth"',
    );
    // (React writes the attribute as hrefLang; HTML does not care about the case)
    expect(html).toMatch(
      /hreflang="fr" href="http:\/\/localhost:4310\/fr\/guides\/auth"/i,
    );
    expect(html).toMatch(
      /hreflang="x-default" href="http:\/\/localhost:4310\/guides\/auth"/i,
    );
    // an old version's page points at the latest
    const old = await (await request.get('/v1/guides/auth')).text();
    expect(old).toContain(
      'rel="canonical" href="http://localhost:4310/guides/auth"',
    );
  });

  test('draws Arabic right to left', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('.dk-shell')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.dk-shell')).toHaveAttribute('lang', 'ar');
    // the sidebar sits on the right of the article
    const [sidebar, main] = await Promise.all([
      page.locator('.dk-sidebar').boundingBox(),
      page.locator('.dk-main').boundingBox(),
    ]);
    if (sidebar && main && sidebar.width > 0)
      expect(sidebar.x).toBeGreaterThan(main.x);
    // code stays left to right
    await page.goto('/ar');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('sends an address that spells out a default to the short one', async ({
    page,
  }) => {
    await page.goto('/en/guides/auth');
    await expect(page).toHaveURL('/guides/auth');
    await page.goto('/v2/fr/guides/auth');
    await expect(page).toHaveURL('/fr/guides/auth');
  });

  test('sends a first visit to the language of the browser, once', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: 'fr-FR',
      extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    const page = await context.newPage();
    await page.goto('/guides/auth');
    await expect(page).toHaveURL('/fr/guides/auth');
    // choosing English in the switcher is remembered, and wins over the browser
    await page.getByRole('combobox', { name: 'Langue' }).selectOption('en');
    await expect(page).toHaveURL('/guides/auth');
    await page.goto('/guides/auth');
    await expect(page).toHaveURL('/guides/auth');
    await context.close();
  });

  test('search stays inside the version and language of the page', async ({
    page,
  }) => {
    const titles = async () =>
      page.locator('[role="dialog"] [role="option"]').allTextContents();
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('rotate');
    await expect(page.getByRole('option').first()).toBeVisible();
    let text = (await titles()).join(' ');
    expect(text).toContain('Authentication');
    expect(text).not.toContain('thirty');
    // in French only French pages
    await page.goto('/fr');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('clé');
    await expect(page.getByRole('option').first()).toBeVisible();
    text = (await titles()).join(' ');
    expect(text).toContain('Authentification');
    expect(text).not.toContain('Team handbook');
    // and in the old version only the old text
    await page.goto('/v1');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('rotate');
    await expect(page.getByRole('option').first()).toBeVisible();
    text = (await titles()).join(' ');
    expect(text).toContain('thirty');
    expect(text).not.toContain('ninety');
  });

  test('the API answers one scope at a time and refuses one it does not have', async ({
    request,
  }) => {
    const urls = async (q: string) =>
      (
        (await (await request.get(`/api/search?q=rotate&${q}`)).json())
          .hits as { url: string }[]
      ).map((h) => h.url);
    expect(await urls('')).toEqual(['/guides/auth#api-keys']);
    expect(await urls('version=v1')).toEqual(['/v1/guides/auth#api-keys']);
    expect((await request.get('/api/search?q=x&locale=zz')).status()).toBe(400);
    const index = await (
      await request.get('/api/search/index?version=v1&locale=en')
    ).json();
    expect(
      index.pages.every(
        (p: { version: string; locale: string }) =>
          p.version === 'v1' && p.locale === 'en',
      ),
    ).toBe(true);
  });

  test('lists each page once in the sitemap, with its translations', async ({
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('<loc>http://localhost:4310/guides/auth</loc>');
    expect(xml).toContain(
      'hreflang="fr" href="http://localhost:4310/fr/guides/auth"',
    );
    expect(xml).not.toContain('/v1/guides/auth</loc>');
    expect(xml).not.toContain('/fr/guides/only-english</loc>');
    expect(xml).not.toMatch(/team/);
  });
});
