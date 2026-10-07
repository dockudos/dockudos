import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LLM_KEY } from './constants';

// The server runs with a model key in its environment. It must reach nobody: not a page, not a script
// the page loads, not an API answer, not the build output, not docs.json.
const KEY_SHAPES = /(?<![A-Za-z0-9_-])sk-(?:ant-)?[A-Za-z0-9_-]{16,}/;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(js|mjs|json|html|rsc|css|txt|map)$/.test(entry.name))
      out.push(path);
  }
  return out;
}

test.describe('the model key stays on the server', () => {
  test('is in no page, script or API answer the browser can get', async ({
    page,
    request,
  }) => {
    const seen: string[] = [];
    page.on('response', async (res) => {
      const type = res.headers()['content-type'] ?? '';
      if (/text|json|javascript|event-stream/.test(type))
        seen.push(`${res.url()}\n${await res.text().catch(() => '')}`);
    });
    await page.goto('/guides/hello');
    await page.getByRole('button', { name: 'Ask the docs' }).click();
    await page
      .getByLabel('Ask a question')
      .fill('How many requests can a key send per minute?');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(/60 requests per minute/).first(),
    ).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.waitForLoadState('networkidle');

    for (const url of [
      '/api/search/index',
      '/api/search?q=key',
      '/api/page?path=/guides/hello',
      '/llms.txt',
      '/llms-full.txt',
      '/guides/hello.md',
    ])
      seen.push(await (await request.get(url)).text());

    expect(seen.length).toBeGreaterThan(10);
    for (const text of seen) {
      expect(text).not.toContain(LLM_KEY);
      expect(text).not.toMatch(KEY_SHAPES);
    }
  });

  test('is in no file of the build the browser downloads, nor in docs.json', async () => {
    const root = process.cwd();
    const checked: string[] = [];
    for (const dir of ['.next/static', 'public'])
      for (const file of await files(join(root, dir))) {
        const text = await readFile(file, 'utf8');
        checked.push(file);
        expect(text, file).not.toContain(LLM_KEY);
        expect(text, file).not.toMatch(KEY_SHAPES);
        // Client code never reads the keys' environment variables.
        expect(text, file).not.toMatch(/DOCKUDOS_(LLM|EMBEDDINGS)_API_KEY/);
      }
    expect(checked.length).toBeGreaterThan(5);
    const config = await readFile(join(root, 'docs.json'), 'utf8');
    expect(config).not.toMatch(KEY_SHAPES);
    // No key *named* like a secret (the word "token" as a value, in an access rule, is fine).
    expect(config).not.toMatch(/"(api[-_]?key|secret|token|password)"\s*:/i);
  });

  test('is not in the server build either, apart from the variable names that read it', async () => {
    const root = process.cwd();
    for (const file of await files(join(root, '.next/server'))) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toContain(LLM_KEY);
    }
  });
});
