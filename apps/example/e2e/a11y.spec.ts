import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  '/',
  '/guides/hello',
  '/guides/features',
  '/guides/components',
  '/guides/code',
  '/guides/api',
  '/layouts/docs',
  '/layouts/notebook',
  '/layouts/spacious',
  '/layouts/flux',
  '/layouts/glass',
  '/layouts/home',
];

for (const scheme of ['light', 'dark'] as const) {
  for (const path of pages) {
    test(`no axe violations on ${path} (${scheme})`, async ({ page }) => {
      // Reduced motion: no element is mid-fade when axe measures its contrast.
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const summary = results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      );
      expect(summary).toEqual([]);
    });
  }
}

test('the page has one main landmark and a single h1', async ({ page }) => {
  await page.goto('/guides/components');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});
