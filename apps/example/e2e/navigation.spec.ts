import { expect, test } from '@playwright/test';

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
