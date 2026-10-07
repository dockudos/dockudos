import { expect, test } from '@playwright/test';
import { LLM_KEY } from './constants';
import { modelCalls } from './fake-llm';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('ask the docs', () => {
  test('the panel streams an answer with numbered sources that open the section', async ({
    page,
  }) => {
    await page.goto('/guides/hello');
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    const dialog = page.getByRole('dialog', { name: /Ask the docs/ });
    await dialog
      .getByLabel('Ask a question')
      .fill('How often do I need to rotate a key?');
    await page.keyboard.press('Enter');

    await expect(dialog.getByText(/ninety days/)).toBeVisible();
    const citation = dialog.getByRole('link', {
      name: /^Source 1: Authentication/,
    });
    await expect(citation).toBeVisible();
    const sources = dialog.getByText('Sources').locator('..');
    await expect(sources.getByRole('link').first()).toHaveAttribute(
      'href',
      '/guides/authentication#api-keys',
    );
    await sources.getByRole('link').first().click();
    await expect(page).toHaveURL('/guides/authentication#api-keys');
    await expect(dialog).toHaveCount(0);
  });

  test('the palette answers a question and shows its sources', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByRole('combobox').fill('How do I change the billing email?');
    const ask = page.getByRole('option').first();
    await expect(ask).toContainText('Ask AI');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/email address that receives invoices/),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Source 1: Billing/ }),
    ).toBeVisible();
    // Esc goes back to search, a second Esc closes.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });

  test('follow-up questions keep the conversation, and it survives a reload', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    const box = page.getByLabel('Ask a question');
    await box.fill('How many requests can a key send per minute?');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/60 requests per minute/).first(),
    ).toBeVisible();
    // Wait for the first answer to finish; a question asked while one is being written is not sent.
    await expect(
      page.getByRole('button', { name: 'Stop answering' }),
    ).toHaveCount(0);
    await box.fill('And what happens when I go over it?');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/429/).first()).toBeVisible();

    // The follow-up carries the first exchange. (The first question may be answered from memory.)
    const calls = await modelCalls(
      request,
      'And what happens when I go over it?',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);

    await page.reload();
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    await expect(
      page.getByText('How many requests can a key send per minute?'),
    ).toBeVisible();
  });

  test('declines a question the docs cannot answer and suggests related pages', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    await page
      .getByLabel('Ask a question')
      .fill('What is the airspeed velocity of an unladen swallow?');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/couldn't find anything/)).toBeVisible();
    // Nothing relevant, so the model was never asked.
    expect(await modelCalls(request, 'airspeed velocity')).toHaveLength(0);
  });

  test('a page that tells the model to ignore its rules changes nothing', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    // A retry must not be served from memory, so it asks in slightly different words.
    const question = `How many times are webhooks retried${'?'.repeat(1 + test.info().retry)}`;
    await page.getByLabel('Ask a question').fill(question);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/three times/).first()).toBeVisible();

    const [call] = await modelCalls(request, question);
    if (!call) throw new Error('the model was never asked');
    const { body } = call;
    // The model is sent instructions and excerpts, with no tools to act with.
    expect(Object.keys(body).sort()).toEqual(
      [
        'max_completion_tokens',
        'max_tokens',
        'messages',
        'model',
        'stream',
      ].filter((k) => k in body),
    );
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).not.toContain('IGNORE ALL PREVIOUS');
    expect(body.messages[0].content).toContain('untrusted');
    expect(body.max_tokens).toBe(800);
    expect(call.authorization).toBe(`Bearer ${LLM_KEY}`);
    // And nothing the page said ends up as an instruction for the reader.
    await expect(page.getByText('attacker@example.com')).toHaveCount(0);
  });

  test('refuses too many questions, and oversized or malformed ones, with a clear message', async ({
    request,
  }) => {
    const ask = (body: unknown, ip = '10.1.1.1') =>
      request.post('/api/ask', {
        headers: { 'x-forwarded-for': ip },
        data: body,
      });

    const long = await ask({ question: 'x'.repeat(501) });
    expect(long.status()).toBe(413);
    expect((await long.json()).error).toBe(
      'The question is longer than 500 characters.',
    );
    expect((await ask({})).status()).toBe(400);
    const bad = await request.post('/api/ask', {
      data: 'not json',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.1.1.1',
      },
    });
    expect(bad.status()).toBe(400);

    const ip = '10.7.7.7';
    let limited;
    for (let i = 0; i < 31; i++) {
      const res = await ask({ question: 'What is the rate limit?' }, ip);
      await res.body();
      if (res.status() === 429) {
        limited = res;
        break;
      }
    }
    if (!limited) throw new Error('the limit was never reached');
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/Too many questions/);
    // Another visitor is not affected.
    const other = await ask(
      { question: 'What is the rate limit?' },
      '10.8.8.8',
    );
    expect(other.status()).toBe(200);
  });

  test('the stream follows the contract: sources first, tokens, then done', async ({
    request,
  }) => {
    const res = await request.post('/api/ask', {
      headers: { 'x-forwarded-for': '10.2.2.2' },
      data: { question: 'How do I cancel my subscription?' },
    });
    expect(res.headers()['content-type']).toContain('text/event-stream');
    const events = (await res.text())
      .split('\n\n')
      .filter(Boolean)
      .map((b) => JSON.parse(b.replace(/^data: /, '')));
    expect(events[0].type).toBe('sources');
    expect(events.at(-1)).toEqual({ type: 'done', citations: [1] });
    expect(events.slice(1, -1).every((e) => e.type === 'token')).toBe(true);
    expect(events[0].items[0]).toMatchObject({
      n: 1,
      path: '/guides/billing',
      anchor: 'cancel-your-subscription',
      url: '/guides/billing#cancel-your-subscription',
    });
  });
});
