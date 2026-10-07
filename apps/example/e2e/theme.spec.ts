import { expect, test } from '@playwright/test';

const html = (page: import('@playwright/test').Page) => page.locator('html');

test('follows the system preference by default', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(html(page)).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(html(page)).not.toHaveClass(/dark/);
});

test('has the right scheme before any script bundle runs (no flash)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('dockudos-theme', 'dark'));
  // Block the app bundles: only the inline script in <head> can set the class.
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.reload();
  await expect(html(page)).toHaveClass(/dark/);
  expect(await html(page).evaluate((el) => el.style.colorScheme)).toBe('dark');
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).not.toBe('rgb(255, 255, 255)');
});

test('the toggle cycles light, dark, system and the choice survives navigation and reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^Theme:/ });
  await expect(toggle).toHaveAccessibleName('Theme: System. Switch to Light');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Theme: Light. Switch to Dark');
  await toggle.click();
  await expect(html(page)).toHaveClass(/dark/);
  await page.getByRole('link', { name: 'Hello guide' }).first().click();
  await expect(page).toHaveURL('/guides/hello');
  await expect(html(page)).toHaveClass(/dark/);
  await page.reload();
  await expect(html(page)).toHaveClass(/dark/);
  await expect(
    page.getByRole('button', { name: /^Theme:/ }),
  ).toHaveAccessibleName('Theme: Dark. Switch to System');
});

test('system mode reacts to a live change of the OS setting', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // the page must have loaded its scripts to see the change
  await expect(html(page)).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveClass(/dark/);
});
