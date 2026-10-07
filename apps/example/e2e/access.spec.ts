import { expect, test } from '@playwright/test';

const reader = { username: 'reader', password: 's3cret-pass' };

test.describe('protected routes', () => {
  test('a protected page asks for credentials and shows nothing without them', async ({
    request,
  }) => {
    const res = await request.get('/private/secret');
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toBe(
      'Basic realm="Example docs", charset="UTF-8"',
    );
    expect(res.headers()['cache-control']).toBe('private, no-store');
    expect(await res.text()).not.toContain('Top secret');
  });

  test('wrong credentials are refused, and either configured account works', async ({
    playwright,
    baseURL,
  }) => {
    const as = (username: string, password: string) =>
      playwright.request.newContext({
        baseURL,
        httpCredentials: { username, password, send: 'always' },
      });
    for (const [u, p, status] of [
      ['reader', 'wrong', 401],
      ['nobody', 's3cret-pass', 401],
      ['reader', 's3cret-pass', 200],
      ['editor', 'other-pass', 200],
    ] as const) {
      const ctx = await as(u, p);
      expect((await ctx.get('/private/secret')).status(), `${u}:${p}`).toBe(
        status,
      );
      await ctx.dispose();
    }
  });

  test.describe('signed in', () => {
    test.use({ httpCredentials: reader });

    test('shows the page, marked private and noindex', async ({ page }) => {
      const response = await page.goto('/private/secret');
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Secret plan' }),
      ).toBeVisible();
      await expect(page.getByText('Top secret plan')).toBeVisible();
      expect(response?.headers()['cache-control']).toBe('private, no-store');
      expect(response?.headers()['x-robots-tag']).toContain('noindex');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
    });

    test('/print is protected too, and then includes the protected page', async ({
      page,
    }) => {
      const res = await page.goto('/print');
      expect(res?.status()).toBe(200);
      await expect(
        page.locator('[data-book-path="/private/secret"]'),
      ).toBeAttached();
    });

    test('the markdown and kudos routes honour the page’s rule', async ({
      request,
    }) => {
      expect(
        (await request.get('/api/markdown?path=/private/secret')).status(),
      ).toBe(200);
      const vote = await request.post('/api/kudos', {
        data: { path: '/private/secret', vote: 'up' },
      });
      expect(vote.status()).toBe(201);
    });
  });

  test('the markdown and kudos routes do not leak a protected page to someone without credentials', async ({
    request,
  }) => {
    const md = await request.get('/api/markdown?path=/private/secret');
    expect(md.status()).toBe(401);
    expect(await md.text()).not.toContain('Top secret');
    // A page that does not exist gets the same answer, so there is nothing to probe.
    expect(
      (await request.get('/api/markdown?path=/private/nothing-here')).status(),
    ).toBe(401);
    expect(
      (
        await request.post('/api/kudos', {
          data: { path: '/private/secret', vote: 'up' },
        })
      ).status(),
    ).toBe(401);
    // Pages with no rule are untouched.
    expect(
      (await request.get('/api/markdown?path=/guides/hello')).status(),
    ).toBe(200);
  });

  test('/print without credentials is refused', async ({ request }) => {
    expect((await request.get('/print')).status()).toBe(401);
  });

  test('any route can be protected: an API route with a token', async ({
    request,
  }) => {
    expect((await request.get('/api/status')).status()).toBe(401);
    expect(
      (
        await request.get('/api/status', {
          headers: { authorization: 'Bearer wrong-token-0000' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.get('/api/status', {
          headers: { authorization: 'Basic ' + btoa('reader:s3cret-pass') },
        })
      ).status(),
    ).toBe(401);
    const ok = await request.get('/api/status', {
      headers: { authorization: 'Bearer example-token-1234' },
    });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(
      (
        await request.get('/api/status', {
          headers: { 'x-docs-token': 'example-token-1234' },
        })
      ).status(),
    ).toBe(200);
  });

  test('odd spellings of a protected URL do not get around the rule', async ({
    request,
    baseURL,
  }) => {
    for (const path of [
      '/private/secret/',
      '//private/secret',
      '/%70rivate/secret',
      '/private/secret?x=1',
      '/private/./secret',
    ]) {
      // A full URL, so a leading // is part of the path and not a host name.
      expect(
        (await request.get(`${baseURL}${path}`, { maxRedirects: 0 })).status(),
        path,
      ).not.toBe(200);
    }
  });

  test('the sitemap and the open pages do not advertise protected ones', async ({
    request,
    page,
  }) => {
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain(
      'private',
    );
    await page.goto('/guides/hello');
    await page.keyboard.press('/');
    await page.getByRole('combobox').fill('Quokka');
    // Nothing found; the only row left is the offer to ask the assistant.
    await expect(
      page.getByRole('option').filter({ hasNotText: /Ask AI|Take me there/ }),
    ).toHaveCount(0);
    // And the open pages are still open.
    expect((await request.get('/guides/hello')).status()).toBe(200);
  });
});
