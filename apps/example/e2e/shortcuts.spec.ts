import { expect, test } from '@playwright/test';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('keyboard shortcuts', () => {
  test('Ctrl/Cmd+K opens search; typing filters; Enter goes to the page', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press(`${MOD}+k`);
    const box = page.getByRole('combobox', { name: 'Search pages' });
    await expect(box).toBeFocused();
    await box.fill('hello');
    await expect(page.getByRole('option').first()).toContainText('Hello guide');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/guides/hello');
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });

  test('"/" and the navbar button open search, and Escape closes it', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page.keyboard.press('/');
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Search pages' }).click();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('"?" lists the shortcuts, including the ones for this page', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Search pages');
    await expect(dialog).toContainText('Next page: Features');
    await expect(dialog).toContainText('Switch theme');
    await expect(dialog).toContainText('Copy this page as Markdown');
    await expect(dialog).toContainText('Edit this page');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('[ and ] move between pages, g then h goes to the first', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page.keyboard.press(']');
    await expect(page).toHaveURL('/guides/features');
    await page.keyboard.press('[');
    await expect(page).toHaveURL('/guides/hello');
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(page).toHaveURL('/');
  });

  test('t switches the theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/guides/hello');
    await page.keyboard.press('t'); // system -> light
    await page.keyboard.press('t'); // light -> dark
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(
      page.getByRole('button', { name: /^Theme: Dark/ }),
    ).toBeVisible();
  });

  test('letters typed into a field are not shortcuts', async ({ page }) => {
    await page.goto('/guides/hello');
    await page.getByRole('button', { name: 'No' }).click();
    const comment = page.getByLabel(/What was missing or wrong/);
    await comment.focus();
    await page.keyboard.type('t]c e/?[');
    await expect(comment).toHaveValue('t]c e/?[');
    await expect(page).toHaveURL('/guides/hello');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('shortcuts do not steal browser combinations', async ({ page }) => {
    await page.goto('/guides/hello');
    await page.keyboard.press(`${MOD}+t`);
    await page.keyboard.press(`${MOD}+]`);
    await expect(page).toHaveURL('/guides/hello');
  });
});

test.describe('page actions', () => {
  test('c copies the page as Markdown, and the button says so', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/guides/hello');
    await page.keyboard.press('c');
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/^# Hello guide\n/);
    expect(text).toContain('## First steps');
    expect(text).not.toContain('title:');
  });

  test('the menu offers Markdown, ChatGPT and Claude, and the edit link points at the source', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page
      .getByRole('button', { name: 'More actions for Hello guide' })
      .click();
    await expect(
      page.getByRole('menuitem', { name: /View as Markdown/ }),
    ).toHaveAttribute('href', '/api/markdown?path=%2Fguides%2Fhello');
    const chat = page.getByRole('menuitem', { name: /Open in ChatGPT/ });
    expect(decodeURIComponent((await chat.getAttribute('href'))!)).toContain(
      'https://docs.example.com/guides/hello',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      'https://github.com/example/site/edit/main/docs/guides/hello.mdx',
    );
  });

  test('the markdown endpoint serves a page and refuses an unknown one', async ({
    request,
  }) => {
    const ok = await request.get('/api/markdown?path=/guides/hello');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toContain('text/markdown');
    expect((await request.get('/api/markdown?path=/nope')).status()).toBe(404);
  });

  test('page actions and shortcut hints are left off the printed page', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.dk-page-actions')).toBeHidden();
    await expect(page.locator('.dk-shortcuts-hint')).toBeHidden();
  });
});

test.describe('icons and the side panel', () => {
  test('a page with an icon in its frontmatter shows it in the sidebar', async ({
    page,
  }) => {
    await page.goto('/guides/api');
    const link = page
      .getByRole('complementary', { name: 'Sidebar' })
      .getByRole('link', { name: 'API example' });
    await expect(link.locator('svg')).toBeVisible();
  });

  test('the panel sits in the right column and stays in view while scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1500, height: 800 });
    await page.goto('/guides/api');
    await expect(page.locator('.dk-toc')).toBeHidden();
    const panel = page.locator('.dk-panel');
    await expect(panel).toBeVisible();
    const article = (await page.locator('.dk-article').boundingBox())!;
    const before = (await panel.boundingBox())!;
    expect(before.x).toBeGreaterThanOrEqual(article.x + article.width - 40);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(100);
    const after = (await panel.boundingBox())!;
    expect(after.y).toBeGreaterThan(0);
    expect(after.y).toBeLessThan(400);
  });

  test('on a narrow screen the panel is part of the page', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto('/guides/api');
    const panel = (await page.locator('.dk-panel').boundingBox())!;
    const article = (await page.locator('.dk-article').boundingBox())!;
    expect(panel.x + panel.width).toBeLessThanOrEqual(
      article.x + article.width + 1,
    );
    await expect(page.getByRole('tab', { name: 'curl' })).toBeVisible();
  });
});
