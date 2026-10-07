import { expect, test } from '@playwright/test';
import { API_KEY, HOST, STRANGER } from './constants';
import { modelCalls } from './fake-llm';

const DOCS = 'http://localhost:4300';

test.describe('the assistant on another site', () => {
  test('the widget opens the docs’ assistant, which answers with the context it was given', async ({
    page,
    request,
  }) => {
    await page.goto(HOST);
    const launch = page.getByRole('button', { name: 'Ask AI' });
    await expect(launch).toHaveAttribute('aria-expanded', 'false');
    // Nothing of the docs is loaded until it is opened.
    await expect(page.locator('iframe')).toHaveCount(0);

    await launch.click();
    await expect(launch).toHaveAttribute('aria-expanded', 'true');
    const frame = page.frameLocator('iframe[title="Ask the docs"]');
    await expect(
      frame.getByRole('heading', { name: 'Ask the Example Docs docs' }),
    ).toBeVisible();
    // The frame is server-rendered first; wait until it can be used.
    await expect(frame.locator('[data-ready="true"]')).toBeAttached();

    // A retry must not be served from memory, so it asks in slightly different words.
    const question = `How many requests can a key send per minute${'?'.repeat(1 + test.info().retry)}`;
    await frame.getByLabel('Ask a question').fill(question);
    await frame.getByLabel('Ask a question').press('Enter');
    await expect(
      frame.getByText(/60 requests per minute/).first(),
    ).toBeVisible();

    const [call] = await modelCalls(request, question);
    if (!call) throw new Error('the model was never asked');
    const prompt = call.body.messages.at(-1)?.content ?? '';
    expect(prompt).toContain('The reader is working on: Billing settings');
    expect(prompt).toContain('The reader is on the page: /guides/billing');

    // A source opens the docs in a new tab, not in the frame.
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      frame.getByRole('link', { name: /^Source 1:/ }).click(),
    ]);
    await expect(tab).toHaveURL(
      /^http:\/\/localhost:4300\/guides\/rate-limits/,
    );
    await tab.close();
    await expect(page).toHaveURL(`${HOST}/`);
  });

  test('the host page can change the context, and Escape closes the widget', async ({
    page,
    request,
  }) => {
    await page.goto(HOST);
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const frame = page.frameLocator('iframe[title="Ask the docs"]');
    await expect(frame.locator('[data-ready="true"]')).toBeAttached();
    await page.evaluate(() =>
      (
        window as unknown as { Dockudos: { setContext(c: object): void } }
      ).Dockudos.setContext({
        hint: 'Webhook settings',
      }),
    );
    const question = `How are webhooks retried${'?'.repeat(1 + test.info().retry)}`;
    await frame.getByLabel('Ask a question').fill(question);
    await frame.getByLabel('Ask a question').press('Enter');
    await expect(frame.getByText(/three times/).first()).toBeVisible();
    const [call] = await modelCalls(request, question);
    expect(call?.body.messages.at(-1)?.content).toContain(
      'The reader is working on: Webhook settings',
    );

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('only listed sites may frame the assistant', async ({ request }) => {
    const res = await request.get('/embed');
    expect(res.status()).toBe(200);
    const policy = res.headers()['content-security-policy'] ?? '';
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain(HOST);
    expect(policy).not.toContain(STRANGER);
    expect(
      (await request.get('/embed')).headers()['x-robots-tag'] ?? '',
    ).toBeDefined();
  });

  test('a listed site can call the API from the browser; a stranger cannot', async ({
    browser,
  }) => {
    const call = (origin: string) =>
      browser.newPage().then(async (page) => {
        await page.goto(origin);
        const result = await page.evaluate(async (docs) => {
          try {
            const res = await fetch(`${docs}/api/ask`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                question: 'How do I cancel my subscription?',
              }),
            });
            return { ok: true, status: res.status, text: await res.text() };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }, DOCS);
        await page.close();
        return result;
      });

    const listed = await call(HOST);
    expect(listed).toMatchObject({ ok: true, status: 200 });
    expect((listed as { text: string }).text).toContain('"type":"done"');
    // The stranger's browser never gets to read an answer.
    expect(await call(STRANGER)).toMatchObject({ ok: false });
  });

  test('a program with an API key can call it, and a wrong key is refused', async ({
    request,
  }) => {
    const ask = (key: string) =>
      request.post('/api/ask', {
        headers: {
          authorization: `Bearer ${key}`,
          'x-forwarded-for': '10.5.5.5',
        },
        data: {
          question: 'How do I cancel my subscription?',
          context: { hint: 'Billing' },
        },
      });
    const ok = await ask(API_KEY);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain('"type":"sources"');
    const wrong = await ask('not-the-key-0123456789');
    expect(wrong.status()).toBe(401);
    expect((await wrong.json()).error).toBe('The API key is not valid.');

    // From a browser origin that is not listed, even a valid key is not enough.
    const stranger = await request.post('/api/ask', {
      headers: { authorization: `Bearer ${API_KEY}`, origin: STRANGER },
      data: { question: 'How do I cancel my subscription?' },
    });
    expect(stranger.status()).toBe(403);
  });
});
