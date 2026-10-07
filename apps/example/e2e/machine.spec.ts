import { expect, test } from '@playwright/test';

const MARKDOWN = { accept: 'text/markdown' };

test.describe('for AI tools', () => {
  test('llms.txt lists public pages as Markdown links', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const text = await res.text();
    expect(text.startsWith('# Example Docs')).toBe(true);
    expect(text).toContain('](https://docs.example.com/guides/hello.md)');
    expect(text).not.toMatch(/private|secret/i);
  });

  test('llms-full.txt has the text of the public pages only', async ({
    request,
  }) => {
    const text = await (await request.get('/llms-full.txt')).text();
    expect(text).toContain('Install the packages and write some MDX.');
    expect(text).toContain('Source: https://docs.example.com/guides/hello');
    expect(text).not.toMatch(/Top secret plan/);
  });

  test('every page has a Markdown twin at .md', async ({ request }) => {
    const res = await request.get('/guides/hello.md');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/markdown');
    expect(await res.text()).toContain('# Hello guide');

    const home = await request.get('/index.md');
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain('# Welcome to Example Docs');
    expect((await request.get('/guides/nope.md')).status()).toBe(404);
  });

  test('Accept: text/markdown returns the twin; browsers still get HTML', async ({
    request,
  }) => {
    const md = await request.get('/guides/hello', { headers: MARKDOWN });
    expect(md.headers()['content-type']).toContain('text/markdown');
    expect(await md.text()).toContain('# Hello guide');
    const home = await request.get('/', { headers: MARKDOWN });
    expect(await home.text()).toContain('# Welcome to Example Docs');

    const html = await request.get('/guides/hello', {
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    });
    expect(html.headers()['content-type']).toContain('text/html');
  });

  test('API routes are not turned into Markdown', async ({ request }) => {
    const res = await request.get('/api/search?q=hello', { headers: MARKDOWN });
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('protected pages stay protected through their twin', async ({
    request,
  }) => {
    expect((await request.get('/private/secret.md')).status()).toBe(401);
    expect(
      (await request.get('/private/secret', { headers: MARKDOWN })).status(),
    ).toBe(401);
    const authed = await request.get('/private/secret.md', {
      headers: { authorization: `Basic ${btoa('reader:s3cret-pass')}` },
    });
    expect(authed.status()).toBe(200);
    expect(await authed.text()).toContain('Top secret plan');
  });
});
