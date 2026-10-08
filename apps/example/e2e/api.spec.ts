import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MOCK = 'http://127.0.0.1:4398';
const NO_CORS = 'http://127.0.0.1:4397';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const SECRET = 'sk-playground-secret-3d9f1c';

const root = join(__dirname, '..');
const spec = JSON.parse(readFileSync(join(root, 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};
const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];
const operations = Object.values(spec.paths).reduce(
  (n, item) => n + METHODS.filter((m) => m in item).length,
  0,
);

function generatedPages(): string[] {
  const dir = join(root, 'docs/api-reference');
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (e) => e.isFile() && e.name.endsWith('.mdx') && e.name !== 'index.mdx',
    )
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length)
        .replace(/\\/g, '/')
        .replace(/\.mdx$/, ''),
    );
}

test.describe('API reference', () => {
  test('renders a page for every operation in the spec', async ({
    request,
  }) => {
    const pages = generatedPages();
    expect(pages).toHaveLength(operations);
    for (const path of pages) {
      const response = await request.get(`/api-reference${path}`);
      expect(response.status(), path).toBe(200);
    }
  });

  test('shows parameters, responses with lazily loaded schemas, and the endpoint', async ({
    page,
  }) => {
    await page.goto('/api-reference/pet/getpetbyid');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Find pet by ID.',
    );
    await expect(page.locator('.dk-endpoint')).toContainText('GET/pet/{petId}');
    await expect(page.getByText('ID of pet to return')).toBeVisible();
    // `category` is a reference: its fields are fetched when it is opened.
    const schemas: string[] = [];
    page.on(
      'request',
      (r) => r.url().includes('/_dockudos/api/') && schemas.push(r.url()),
    );
    await page.getByRole('button', { name: 'category' }).click();
    await expect(page.getByText('Category').first()).toBeVisible();
    await expect(
      page
        .locator('.dk-api-children .dk-param-name', { hasText: 'name' })
        .first(),
    ).toBeVisible();
    expect(schemas.some((u) => u.endsWith('/~category.json'))).toBe(true);
  });

  test('sidebar groups endpoints by tag with their method', async ({
    page,
  }) => {
    await page.goto('/api-reference');
    await page.locator('.dk-nav-list summary', { hasText: /^pet$/ }).click();
    await expect(
      page.locator('.dk-api-method[data-method="get"]').first(),
    ).toBeVisible();
  });

  test('search finds an endpoint by path and by summary', async ({ page }) => {
    for (const query of ['/pet/findByStatus', 'Finds Pets by status']) {
      await page.goto('/');
      await page.keyboard.press(`${MOD}+k`);
      await page.getByRole('combobox', { name: 'Search pages' }).fill(query);
      await expect(page.getByRole('option').first()).toContainText(
        'Finds Pets by status',
      );
    }
  });

  test('the code sample language is remembered on other pages', async ({
    page,
  }) => {
    await page.goto('/api-reference/pet/getpetbyid');
    await page.getByRole('tab', { name: 'Python' }).click();
    await expect(page.getByText('requests.request(')).toBeVisible();
    await page.goto('/api-reference/store/getinventory');
    await expect(page.getByRole('tab', { name: 'Python' })).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByText('requests.request(')).toBeVisible();
  });

  test('the Markdown twin has the whole endpoint for AI tools', async ({
    request,
  }) => {
    const text = await (
      await request.get('/api-reference/pet/getpetbyid.md')
    ).text();
    expect(text).toContain('`GET /pet/{petId}`');
    expect(text).toContain('| petId | path |');
    expect(text).toContain('### Responses');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no axe violations on an endpoint page (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto('/api-reference/pet/addpet');
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});

/** Go to a page and wait until it is interactive: a field filled before hydration is reset by it. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('playground', () => {
  // They share one mock API and read what it recorded, so they take turns.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => {
    await request.delete(`${MOCK}/__calls`);
  });

  test('calls a live API and shows status, timing, headers and the body', async ({
    page,
    request,
  }) => {
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel('petId').fill('1');
    await page.getByLabel(/api_key: API key/).fill(SECRET);
    await page.getByRole('button', { name: 'Send request' }).click();
    const response = page.getByRole('region', { name: 'Response' });
    await expect(response).toContainText('200');
    await expect(response).toContainText(/\d+ ms/);
    await expect(response.getByTestId('api-response-body')).toContainText(
      '"name": "Rex"',
    );
    await response.getByText(/Headers \(/).click();
    await expect(response.getByText('x-mock')).toBeVisible();

    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      path: string;
      headers: Record<string, string>;
    }[];
    const call = calls.find((c) => c.path === '/api/v3/pet/1');
    expect(call?.headers.api_key).toBe(SECRET);
  });

  test('sends a JSON body and shows what the API answered', async ({
    page,
    request,
  }) => {
    await open(page, '/api-reference/pet/addpet');
    const body = page.getByRole('textbox', { name: /Body/ });
    await body.fill(
      JSON.stringify({ id: 77, name: 'Fido', photoUrls: [], status: 'sold' }),
    );
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByTestId('api-response-body')).toContainText(
      '"name": "Fido"',
    );
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      method: string;
      body: string;
    }[];
    expect(
      JSON.parse(calls.find((c) => c.method === 'POST')?.body ?? '{}'),
    ).toMatchObject({ id: 77 });
  });

  test('validates input against the schema before sending', async ({
    page,
    request,
  }) => {
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel('petId').fill('abc');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Must be an integer')).toBeVisible();
    await page.getByLabel('petId').fill('');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Required' }),
    ).toBeVisible();
    expect(await (await request.get(`${MOCK}/__calls`)).json()).toEqual([]);

    await open(page, '/api-reference/pet/addpet');
    await page.getByRole('textbox', { name: /Body/ }).fill('{ nope');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/Not valid JSON/)).toBeVisible();
  });

  test('explains a CORS failure and how to fix it', async ({ page }) => {
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel('Base URL').fill(`${NO_CORS}/api/v3`);
    await page.getByLabel('petId').fill('1');
    await page.getByRole('button', { name: 'Send request' }).click();
    const failure = page
      .getByRole('alert')
      .filter({ hasText: 'could not be sent' });
    await expect(failure).toContainText('CORS');
    await expect(failure).toContainText('playground.proxy');
  });

  test('secrets typed in go only to the API being tried', async ({ page }) => {
    const seen: { url: string; carriesSecret: boolean }[] = [];
    page.on('request', (r) => {
      const hasIt =
        JSON.stringify(r.headers()).includes(SECRET) ||
        (r.postData() ?? '').includes(SECRET) ||
        r.url().includes(SECRET);
      seen.push({ url: r.url(), carriesSecret: hasIt });
    });
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel(/api_key: API key/).fill(SECRET);
    await page.getByLabel('petId').fill('1');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('region', { name: 'Response' })).toBeVisible();
    // Move around the site: nothing else is sent the secret, and it is not in the page's own storage.
    await open(page, '/api-reference/pet/findpetsbystatus');
    await open(page, '/');
    const leaked = seen
      .filter((s) => s.carriesSecret)
      .map((s) => new URL(s.url).origin);
    expect([...new Set(leaked)]).toEqual([MOCK]);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage }),
    );
    expect(stored).not.toContain(SECRET);
  });

  test('credentials are shared between endpoint pages in the same tab', async ({
    page,
  }) => {
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel(/api_key: API key/).fill(SECRET);
    await open(page, '/api-reference/store/getinventory');
    await expect(page.getByLabel(/api_key: API key/)).toHaveValue(SECRET);
  });
});
