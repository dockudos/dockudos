import { expect, test } from '@playwright/test';

const IDP = 'http://127.0.0.1:4311';
const signInAs = (
  request: import('@playwright/test').APIRequestContext,
  sub: string,
  roles: string,
) => request.get(`${IDP}/__user?sub=${sub}&roles=${roles}`);

test.describe('a private section behind login', () => {
  test('is closed to a visitor: redirected to sign in, and absent from every public surface', async ({
    request,
  }) => {
    const gate = await request.get('/team/handbook', {
      headers: { accept: 'text/html' },
      maxRedirects: 0,
    });
    expect(gate.status()).toBe(302);
    expect(gate.headers()['location']).toBe(
      '/api/auth/login?returnTo=%2Fteam%2Fhandbook',
    );
    expect(
      (
        await request.get('/fr/team/handbook', {
          headers: { accept: 'text/html' },
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(302);
    // scripts are told they are not signed in
    expect((await request.get('/api/page?path=/team/handbook')).status()).toBe(
      401,
    );
    expect((await request.get('/team/handbook.md')).status()).toBe(401);

    const surfaces = [
      '/api/search?q=salaries',
      '/api/search/index?version=v2&locale=en',
      '/api/search/index?version=v2&locale=fr',
      '/llms.txt',
      '/llms-full.txt',
      '/sitemap.xml',
      '/changelog.xml',
      '/rss.xml',
      '/',
      '/print',
      '/guides/auth',
    ];
    for (const path of surfaces) {
      const body = await (await request.get(path)).text();
      expect(body, path).not.toContain('SECRET-');
      expect(body, path).not.toContain('Team handbook');
    }
    // the assistant's neighbor, MCP, searches the public pages only
    const mcp = await request.post('/mcp', {
      headers: { 'content-type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: { query: 'salaries on-call rota' },
        },
      },
    });
    expect(JSON.stringify(await mcp.json())).not.toContain('SECRET-');
    const og = await request.get('/og/team/handbook.png');
    expect(og.status()).toBe(200); // a bare card with the site name
  });

  test('signs a staff member in through the provider, returns to the page, and shows it in search', async ({
    page,
    request,
  }) => {
    await signInAs(request, 'ada', 'staff');
    await page.goto('/team/handbook');
    await expect(page).toHaveURL('/team/handbook');
    await expect(page.getByText('SECRET-TEAM-HANDBOOK')).toBeVisible();
    // the private page now shows up in the palette
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').first().fill('salaries');
    await expect(
      page.getByRole('option', { name: /Team handbook/ }).first(),
    ).toBeVisible();
    // and in the session
    const me = await page.request.get('/api/auth/session');
    expect((await me.json()).user).toMatchObject({
      sub: 'ada',
      roles: ['staff'],
    });
    // the French copy is private too, and open to the same person
    await page.goto('/fr/team/handbook');
    await expect(page.getByText('SECRET-FR-TEAM')).toBeVisible();
  });

  test('refuses a signed-in user without the role', async ({
    page,
    request,
  }) => {
    await signInAs(request, 'guest', 'reader');
    const response = await page.goto('/team/handbook');
    expect(response?.status()).toBe(403);
    await expect(page.getByText('SECRET-TEAM-HANDBOOK')).toHaveCount(0);
    const found = await page.request.get('/api/search?q=salaries');
    expect(JSON.stringify(await found.json())).not.toContain('Team handbook');
  });

  test('signs out', async ({ page, request }) => {
    await signInAs(request, 'ada', 'staff');
    await page.goto('/team/handbook');
    await expect(page.getByText('SECRET-TEAM-HANDBOOK')).toBeVisible();
    const out = await page.request.post('/api/auth/logout', {
      headers: { origin: 'http://localhost:4310' },
      maxRedirects: 0,
    });
    expect(out.status()).toBe(303);
    await page.context().clearCookies();
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  });

  test('will not sign in with a forged state', async ({ request }) => {
    const res = await request.get('/api/auth/callback?code=x&state=y', {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(400);
  });
});
