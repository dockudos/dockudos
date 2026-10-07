import { expect, test } from '@playwright/test';
import { LLM_KEY } from './constants';
import { modelCalls } from './fake-llm';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('AI navigation', () => {
  test('a request jumps to the right heading and says why', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('change the billing email');
    // Plain search already finds the section; the assistant's row is one down from the results.
    await page
      .getByRole('option', {
        name: /Take me there: “change the billing email”/,
      })
      .click();

    await expect(page).toHaveURL('/guides/billing#change-the-billing-email');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Change the billing email' }),
    ).toBeInViewport();
    const notice = page.locator('.dk-nav-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Billing › Change the billing email');
    await expect(notice).toContainText(
      'This section covers change the billing email.',
    );
  });

  test('Ctrl/Cmd+Enter from search results does the same', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('cancel subscription');
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page).toHaveURL('/guides/billing#cancel-your-subscription');
  });

  test('when two places fit equally it shows the choices instead of jumping', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('limit');
    await page.keyboard.press(`${MOD}+Enter`);

    const options = page.getByRole('option');
    await expect(options.nth(1)).toBeVisible();
    await expect(options.first()).toContainText('Best guess');
    await expect(
      page.getByRole('listbox').getByText(/Not sure which you mean/),
    ).toBeVisible();
    expect(page.url()).not.toContain('#');
    const second = options.nth(1);
    const label = (await second.textContent()) ?? '';
    await second.click();
    await expect(page).not.toHaveURL('/');
    // Landed on the page the second choice named.
    const title = label.split(' › ')[0]?.trim() ?? '';
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      title.slice(0, 5),
    );
  });

  test('nothing matching is said plainly', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('quantum llamas');
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(
      page.getByText('Nothing in the docs matches that.').first(),
    ).toBeVisible();
  });

  test('the route returns the target, never a protected or hidden page', async ({
    request,
  }) => {
    const res = await request.post('/api/navigate', {
      headers: { 'x-forwarded-for': '10.3.3.3' },
      data: { query: 'how do I verify a webhook signature' },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      path: '/guides/webhooks',
      anchor: 'verify-the-signature',
      url: '/guides/webhooks#verify-the-signature',
      confidence: 'high',
      ranked: 'model',
      reason: expect.any(String),
    });

    const secret = await request.post('/api/navigate', {
      headers: { 'x-forwarded-for': '10.3.3.3' },
      data: { query: 'Bluefin-Quokka launch codename' },
    });
    expect(secret.status()).toBe(404);
    expect(await secret.text()).not.toContain('private');

    const bad = await request.post('/api/navigate', {
      headers: { 'x-forwarded-for': '10.3.3.3' },
      data: { query: 'x'.repeat(501) },
    });
    expect(bad.status()).toBe(413);
  });

  test('the model sees short quotations and no tools, and the key stays out of the answer', async ({
    request,
  }) => {
    // A retry must not be served from memory, so it asks in slightly different words.
    const query = `how do I paginate with a cursor${'?'.repeat(test.info().retry)}`;
    const res = await request.post('/api/navigate', {
      headers: { 'x-forwarded-for': '10.4.4.4' },
      data: { query },
    });
    expect(await res.text()).not.toContain(LLM_KEY);
    const [call] = await modelCalls(request, query);
    if (!call) throw new Error('the model was never asked');
    expect(call.body.tools).toBeUndefined();
    const user = call.body.messages.at(-1)?.content ?? '';
    expect(user).toContain('<<<OPTION');
    expect(user.endsWith('Request: how do I paginate with a cursor')).toBe(
      true,
    );
  });
});
