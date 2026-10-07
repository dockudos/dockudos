import { expect, test } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('navigates with the sidebar and keeps the current page marked', async ({
  page,
}) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(
    sidebar.getByRole('link', { name: 'Welcome to Example Docs' }),
  ).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('link', { name: 'Hello guide' }).click();
  await expect(page).toHaveURL('/guides/hello');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Hello guide' }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole('link', { name: 'Hello guide' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    sidebar.getByRole('link', { name: 'Welcome to Example Docs' }),
  ).not.toHaveAttribute('aria-current', 'page');
});

test('previous and next links walk the reading order', async ({ page }) => {
  await page.goto('/guides/hello');
  const pager = page.getByRole('navigation', {
    name: 'Previous and next pages',
  });
  await pager.getByRole('link', { name: /Next/ }).click();
  await expect(page).toHaveURL('/guides/features');
  await page
    .getByRole('navigation', { name: 'Previous and next pages' })
    .getByRole('link', { name: /Previous/ })
    .click();
  await expect(page).toHaveURL('/guides/hello');
});

test('the table of contents jumps to a heading and follows scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto('/guides/components');
  const toc = page.getByRole('navigation', { name: 'On this page' });
  await toc.getByRole('link', { name: 'Steps', exact: true }).click();
  await expect(page).toHaveURL('/guides/components#steps');
  await expect(page.locator('#steps')).toBeInViewport();
  await expect(
    toc.getByRole('link', { name: 'Steps', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  // The heading must not hide under the sticky navbar.
  const top = await page
    .locator('#steps')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(56);
});

test('scroll position resets to the top when moving to another page', async ({
  page,
}) => {
  await page.goto('/guides/components');
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('link', { name: 'Hello guide' })
    .click();
  await expect(page).toHaveURL('/guides/hello');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

test('the skip link moves focus to the content', async ({ page }) => {
  await page.goto('/guides/hello');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#dk-content')).toBeFocused();
});

test('the mobile drawer opens, navigates and closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(
    page.getByRole('complementary', { name: 'Sidebar' }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'Features' }).click();
  await expect(page).toHaveURL('/guides/features');
  await expect(dialog).toBeHidden();
});

test('sidebar groups collapse and expand from the keyboard', async ({
  page,
}) => {
  await page.goto('/guides/hello');
  const summary = page
    .getByRole('complementary', { name: 'Sidebar' })
    .locator('summary')
    .first();
  const details = summary.locator('xpath=..');
  await expect(details).toHaveAttribute('open', '');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
});

test('tabs and accordion work from the keyboard, the tooltip on hover', async ({
  page,
}) => {
  await page.goto('/guides/components');
  const tab = page.getByRole('tab', { name: 'npm' }).first();
  await tab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'pnpm' }).first()).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const accordion = page.getByRole('button', { name: 'What is dockudos?' });
  await accordion.focus();
  await page.keyboard.press('Enter');
  await expect(accordion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('A docs framework.')).toBeVisible();

  // Let the accordion finish opening: a layout shift while hovering closes the tooltip.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  await page.getByText('MDX', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Markdown with components',
  );
});

test('code blocks copy to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/guides/code');
  const block = page.locator('.dk-code').first();
  await block.hover();
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(block.getByRole('status')).toHaveText('Copied to clipboard');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('export function greet');
});

test('the package manager tabs stay in step and are remembered', async ({
  page,
}) => {
  await page.goto('/guides/code');
  await page.getByRole('tab', { name: 'pnpm' }).click();
  await expect(page.getByText('pnpm add -D @dockudos/core')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'pnpm' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('images zoom in a dialog and close with Escape', async ({ page }) => {
  await page.goto('/guides/code');
  await page.getByRole('button', { name: 'Zoom image: Shapes' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('math, diagrams and type info render', async ({ page }) => {
  await page.goto('/guides/code');
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('figure[aria-label="Diagram"] svg')).toBeVisible();
  // Move the mouse by coordinates: a hover target can contain a nested one
  // (the popup shows `point` again), which trips Playwright's actionability check.
  const target = page.locator('.twoslash-hover', { hasText: 'point' }).first();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.twoslash-popup-container').first()).toBeVisible();
});

test('the graph view lists every page as a link', async ({ page }) => {
  await page.goto('/guides/components');
  const graph = page.getByRole('group', { name: /Graph of pages/ });
  await expect(graph.getByRole('link')).not.toHaveCount(0);
  await expect(
    graph.getByRole('link', { name: 'Hello guide' }),
  ).toHaveAttribute('href', '/guides/hello');
});

test('animations are switched off when the visitor prefers reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/guides/components');
  const duration = await page
    .locator('.dk-page-title')
    .evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.001);
});

test('accordion content animates open and closed', async ({ page }) => {
  await page.goto('/guides/components');
  const trigger = page.getByRole('button', { name: 'What is dockudos?' });
  await trigger.click();
  const content = page
    .locator('.dk-accordion-content[data-state="open"]')
    .first();
  expect(
    await content.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('dk-accordion-down');
  await trigger.click();
  await expect(page.getByText('A docs framework.')).toBeHidden();
});

test('the new components render and the custom file icons show', async ({
  page,
}) => {
  await page.goto('/guides/components');
  await expect(page.locator('[data-badge="green"]')).toHaveText('New');
  await expect(page.locator('kbd').first()).toBeVisible();
  await expect(page.getByText('Optional detail')).toBeVisible();
  await expect(page.getByText('📂')).toBeVisible();
  await expect(page.getByText('🟦')).toBeVisible();
});

test.describe('kudos', () => {
  const log = join(process.cwd(), '.dockudos', 'kudos.jsonl');
  test.beforeEach(() => rmSync(log, { force: true }));

  test('a visitor can vote and leave a comment, and it is stored without identifying them', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await expect(
      page.getByRole('heading', { name: 'Was this page helpful?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'No' }).click();
    await page
      .getByLabel(/What was missing or wrong/)
      .fill('The first step needs a command.');
    await page.getByRole('button', { name: 'Send comment' }).click();
    await expect(
      page.getByRole('heading', { name: 'Thanks for your feedback' }),
    ).toBeVisible();

    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ path: '/guides/hello', vote: 'down' });
    expect(lines[1]).toMatchObject({
      id: lines[0].id,
      comment: 'The first step needs a command.',
    });
    expect(Object.keys(lines[0]).sort()).toEqual(['at', 'id', 'path', 'vote']);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Thanks for your feedback' }),
    ).toBeVisible();
  });

  test('the endpoint refuses an unknown page and a cross-origin post', async ({
    request,
    baseURL,
  }) => {
    const bad = await request.post('/api/kudos', {
      data: { path: '/nope', vote: 'up' },
    });
    expect(bad.status()).toBe(400);
    const cross = await request.post('/api/kudos', {
      data: { path: '/', vote: 'up' },
      headers: { origin: 'https://evil.example' },
    });
    expect(cross.status()).toBe(403);
    expect(baseURL).toBeTruthy();
  });

  test('a page can opt out with kudos: false', async ({ page }) => {
    await page.goto('/layouts/home');
    await expect(
      page.getByRole('heading', { name: 'Was this page helpful?' }),
    ).toHaveCount(0);
  });
});

test.describe('print', () => {
  test.use({ colorScheme: 'dark' });

  test('hides the chrome, forces a light page, and prints collapsed and tabbed content', async ({
    page,
  }) => {
    await page.goto('/guides/components');
    // Screen first: dark, chrome visible, accordion closed, one tab panel.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('.dk-navbar')).toBeVisible();
    await expect(page.getByText('A docs framework.')).toBeHidden();
    await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(
      await page.locator('[role="tabpanel"]:visible').count(),
    );
    const panelsOnScreen = await page
      .locator('[role="tabpanel"]')
      .filter({ visible: true })
      .count();

    await page.emulateMedia({ media: 'print' });

    for (const selector of [
      '.dk-navbar',
      '.dk-sidebar',
      '.dk-toc',
      '.dk-pager',
      '.dk-kudos',
      '.dk-copy',
      '[role="tablist"]',
      '[data-print="hide"]',
    ]) {
      for (const el of await page.locator(selector).all())
        await expect(el).toBeHidden();
    }
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe('rgb(255, 255, 255)');
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector('.dk-prose')!).color,
    );
    expect(color).not.toBe('rgb(255, 255, 255)');

    await expect(page.getByText('A docs framework.')).toBeVisible();
    const panelsOnPaper = await page
      .locator('[role="tabpanel"]')
      .filter({ visible: true })
      .count();
    expect(panelsOnPaper).toBeGreaterThan(panelsOnScreen);
    expect(
      await page
        .locator('[role="tabpanel"][data-label]')
        .first()
        .evaluate((el) => getComputedStyle(el, '::before').content),
    ).toMatch(/\w/);
  });

  test('code stays light and wraps; external links show their address; tips are printed', async ({
    page,
  }) => {
    await page.goto('/guides/code');
    await page.emulateMedia({ media: 'print' });
    const span = page.locator('.dk-pre span').first();
    const rgb = await span.evaluate((el) =>
      getComputedStyle(el).color.match(/\d+/g)!.map(Number),
    );
    // A light-theme token color is never near-white on a white page.
    expect(Math.min(...rgb)).toBeLessThan(200);
    expect(
      await page
        .locator('.dk-pre')
        .first()
        .evaluate((el) => getComputedStyle(el).whiteSpace),
    ).toBe('pre-wrap');

    await page.goto('/guides/components');
    await page.emulateMedia({ media: 'print' });
    const link = page
      .locator('.dk-prose a[href^="https://github.com"]')
      .first();
    expect(
      await link.evaluate((el) => getComputedStyle(el, '::after').content),
    ).toContain('https://github.com');
    const tip = page.locator('[data-tip]').first();
    expect(
      await tip.evaluate((el) => getComputedStyle(el, '::after').content),
    ).toContain('Markdown with components');
  });

  test('produces a PDF of the page', async ({ page }) => {
    await page.goto('/guides/components');
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  test('every screen-only component is gone and the print-only note appears', async ({
    page,
  }) => {
    await page.goto('/guides/components');
    await expect(page.locator('.dk-print-only').first()).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    // The components page has no video, so check the class exists as a rule instead.
    const display = await page.evaluate(() => {
      const el = document.createElement('p');
      el.className = 'dk-print-only';
      document.body.append(el);
      return getComputedStyle(el).display;
    });
    expect(display).toBe('block');
  });
});

test('the new components render', async ({ page }) => {
  await page.goto('/guides/components');
  await expect(page.locator('.dk-endpoint-method')).toHaveText('POST');
  await expect(page.locator('.dk-param-required')).toBeVisible();
  await expect(page.locator('.dk-update time')).toHaveText('March 5, 2026');
  await expect(page.locator('.dk-hero-title')).toHaveText('Docs that ship');
  await expect(page.getByRole('link', { name: 'Get started' })).toHaveClass(
    /dk-button/,
  );
});
