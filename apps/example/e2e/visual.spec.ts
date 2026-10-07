import { expect, test } from '@playwright/test';

const layouts = [
  'docs',
  'notebook',
  'spacious',
  'flux',
  'glass',
  'home',
] as const;
const pages = {
  components: '/guides/components',
  code: '/guides/code',
} as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    for (const layout of layouts) {
      test(`layout ${layout}`, async ({ page }) => {
        await page.goto(`/layouts/${layout}`);
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`layout-${layout}-${scheme}.png`, {
          mask: [page.locator('.dk-last-modified')],
        });
      });
    }

    for (const [name, path] of Object.entries(pages)) {
      test(`components: ${name}`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        // Diagrams render in the browser; wait for them.
        if (name === 'code')
          await page.locator('figure[aria-label="Diagram"] svg').waitFor();
        await expect(page).toHaveScreenshot(`page-${name}-${scheme}.png`, {
          fullPage: true,
        });
      });
    }
  });
}
