import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The API client in a real browser: real IndexedDB, real reloads, and a look inside both storages afterwards to prove
 * that no credential was kept.
 */

const MOCK = 'http://127.0.0.1:4398';
const SECRET = 'sk-client-secret-7a21f0';

/** Go to a page and wait until it is interactive: a field filled before hydration is reset by it. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** The client's panel, which sits over the endpoint page: the page's own fields are not meant. */
const client = (page: Page) => page.getByRole('dialog', { name: 'API client' });

/** The client lives over every endpoint page: open one and press Saved requests. */
async function openClient(page: Page) {
  await open(page, '/api-reference/pet/getpetbyid');
  await page.getByRole('button', { name: 'Saved requests' }).click();
  await expect(page.getByRole('dialog', { name: 'API client' })).toBeVisible();
}

/** The address field. `getByLabel` would also match the history note, which mentions the address. */
const address = (on: Page | ReturnType<Page['getByRole']>) =>
  on.getByRole('textbox', { name: 'Address' });

/** Everything the page has in storage, as text, to search for a secret. */
const storedText = (page: Page) =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const records: unknown[] = [];
    for (const { name } of databases) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of [...db.objectStoreNames]) {
        const all = await new Promise<unknown[]>((resolve) => {
          const request = db
            .transaction(store, 'readonly')
            .objectStore(store)
            .getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => resolve([]);
        });
        records.push(...all);
      }
      db.close();
    }
    return JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      records,
    });
  });

/** Add an environment with a plain and a secret variable in the client. */
async function makeEnvironment(page: Page) {
  await page.getByRole('tab', { name: /Environments/ }).click();
  await page.getByRole('button', { name: 'New environment' }).click();
  await page.getByRole('button', { name: 'Add a variable' }).click();
  await page.getByLabel('Variable 1 name').fill('baseUrl');
  await page.getByLabel(/Value of baseUrl/).fill(`${MOCK}/api/v3`);
  await page.getByRole('button', { name: 'Add a variable' }).click();
  await page.getByLabel('Variable 2 name').fill('key');
  await page.getByLabel(/Value of key/).fill(SECRET);
  await page.getByLabel('key is secret').check();
}

test.describe('the API client page', () => {
  // They share the mock API and read what it recorded, so they take turns.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => {
    await request.delete(`${MOCK}/__calls`);
  });

  test('saves a request, survives a reload, and sends it again', async ({
    page,
    request,
  }) => {
    await openClient(page);
    await address(client(page)).fill(`${MOCK}/api/v3/pet/1`);
    await client(page)
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Find Rex');
    await client(page).getByRole('button', { name: /^Save$/ }).click();
    await expect(client(page).getByTestId('api-client-note')).toContainText(
      'Saved “Find Rex”',
    );

    // It is still there after a reload, with its address.
    await openClient(page);
    const tree = client(page).getByRole('tree', { name: 'Collections' });
    await tree.getByRole('treeitem', { name: /Find Rex/ }).click();
    await expect(address(client(page))).toHaveValue(`${MOCK}/api/v3/pet/1`);

    await client(page).getByRole('button', { name: 'Send' }).click();
    const response = client(page).getByRole('region', { name: 'Response' });
    await expect(response).toContainText('200');
    await expect(response.getByTestId('api-response-body')).toContainText(
      '"name": "Rex"',
    );
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      path: string;
    }[];
    expect(calls.some((c) => c.path === '/api/v3/pet/1')).toBe(true);
  });

  test('sends with an environment, and keeps the secret out of storage', async ({
    page,
    request,
  }) => {
    await openClient(page);
    await makeEnvironment(page);
    await client(page).getByRole('tab', { name: /Collections/ }).click();
    await address(client(page)).fill('{{baseUrl}}/pet/1');
    await client(page).getByRole('button', { name: 'Add a header' }).click();
    await client(page).getByLabel('Header 1 name').fill('api_key');
    await client(page).getByLabel(/Value of api_key/).fill('{{key}}');
    await expect(client(page).getByText(/Sends to/)).toContainText(
      `${MOCK}/api/v3/pet/1`,
    );

    await client(page).getByRole('button', { name: 'Send' }).click();
    await expect(client(page).getByRole('region', { name: 'Response' })).toContainText(
      '200',
    );
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      headers: Record<string, string>;
    }[];
    expect(calls.at(-1)?.headers.api_key).toBe(SECRET);

    // The request is kept with the variable in it, and the secret only in the tab's own storage.
    await client(page)
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('With a key');
    await client(page).getByRole('button', { name: /^Save$/ }).click();
    await expect(client(page).getByTestId('api-client-note')).toContainText('Saved');
    const stored = JSON.parse(await storedText(page)) as {
      local: Record<string, string>;
      session: Record<string, string>;
      records: { request?: { headers?: [string, string][] } }[];
    };
    expect(JSON.stringify(stored.local)).not.toContain(SECRET);
    expect(JSON.stringify(stored.records)).not.toContain(SECRET);
    expect(JSON.stringify(stored.records)).toContain('{{key}}');
    expect(JSON.stringify(stored.session)).toContain(SECRET);

    // A new tab shares the stored environment but not the tab's secrets: the value is asked for again.
    const other = await page.context().newPage();
    await other.goto('/api-reference/pet/getpetbyid');
    await other.waitForLoadState('networkidle');
    await other.getByRole('button', { name: 'Saved requests' }).click();
    await other.getByRole('tab', { name: /Environments/ }).click();
    await expect(
      other.getByRole('button', { name: /Not set — show/ }),
    ).toBeVisible();
    await other.close();
  });

  test('leaves a request that used a secret out of the history, unless asked', async ({
    page,
  }) => {
    await openClient(page);
    await makeEnvironment(page);
    await client(page).getByRole('tab', { name: /Collections/ }).click();
    await address(client(page)).fill('{{baseUrl}}/pet/1');
    await client(page).getByRole('button', { name: 'Add a header' }).click();
    await client(page).getByLabel('Header 1 name').fill('api_key');
    await client(page).getByLabel(/Value of api_key/).fill('{{key}}');
    await client(page).getByRole('button', { name: 'Send' }).click();
    await expect(client(page).getByRole('region', { name: 'Response' })).toContainText(
      '200',
    );

    await client(page).getByRole('tab', { name: /History/ }).click();
    await expect(
      client(page).getByText('Nothing sent yet from this browser.'),
    ).toBeVisible();
    await client(page)
      .getByRole('checkbox', { name: /used a secret variable/ })
      .check();
    await client(page).getByRole('tab', { name: /Collections/ }).click();
    await client(page).getByRole('button', { name: 'Send' }).click();
    await expect(client(page).getByRole('region', { name: 'Response' })).toContainText(
      '200',
    );
    await client(page).getByRole('tab', { name: /History/ }).click();
    // What is listed is the address as it was written, never the value behind the variable.
    await expect(
      client(page).getByRole('button', { name: /\{\{baseUrl\}\}\/pet\/1/ }),
    ).toBeVisible();
    expect(await storedText(page)).not.toContain(SECRET.slice(0, 12) + '"');
  });

  test('imports a collection from a file and names the variables it needs', async ({
    page,
  }) => {
    await openClient(page);
    await client(page).getByRole('button', { name: 'Import or export' }).click();
    await client(page).getByLabel(/From a file/).setInputFiles({
      name: 'petstore.postman_collection.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          info: { name: 'Imported petstore', schema: 'v2.1' },
          item: [
            {
              name: 'Find pet',
              event: [
                {
                  listen: 'test',
                  script: { exec: ['pm.test("x", () => {})'] },
                },
              ],
              request: { method: 'GET', url: { raw: '{{petsUrl}}/pet/1' } },
            },
          ],
        }),
      ),
    });
    const tree = client(page).getByRole('tree', { name: 'Collections' });
    await expect(
      tree.getByRole('treeitem', { name: /Find pet/ }),
    ).toBeVisible();
    await expect(
      client(page).getByText(/Scripts in the file were ignored/),
    ).toBeVisible();
    await expect(client(page).getByText(/\{\{petsUrl\}\}/)).toBeVisible();
  });

  test('shares a request as a link that carries no credential', async ({
    page,
  }) => {
    await openClient(page);
    await address(client(page)).fill(`${MOCK}/api/v3/pet/1`);
    await client(page).getByRole('button', { name: 'Add a header' }).click();
    await client(page).getByLabel('Header 1 name').fill('Authorization');
    await client(page).getByLabel(/Value of Authorization/).fill(`Bearer ${SECRET}`);
    await client(page).getByRole('button', { name: 'Share' }).click();
    const link = await client(page).getByLabel(/Link to this request/).inputValue();
    expect(link).not.toContain(SECRET);

    await page.goto(link);
    await page.waitForLoadState('networkidle');
    await expect(address(client(page))).toHaveValue(`${MOCK}/api/v3/pet/1`);
    await expect(client(page).getByTestId('api-client-note')).toContainText(
      'came from a link',
    );
    await expect(client(page).getByLabel(/Value of Authorization/)).toHaveValue('');
  });

  test('can be worked with from the keyboard alone', async ({ page }) => {
    await openClient(page);
    await address(client(page)).fill(`${MOCK}/api/v3/pet/1`);
    await client(page)
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('First');
    await client(page).getByRole('button', { name: /^Save$/ }).click();
    await client(page).getByRole('button', { name: 'New request' }).click();
    await address(client(page)).fill(`${MOCK}/api/v3/pet/1`);
    await client(page)
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Second');
    await client(page).getByRole('button', { name: /^Save$/ }).click();

    const tree = client(page).getByRole('tree', { name: 'Collections' });
    await tree.getByRole('treeitem').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(tree.getByRole('treeitem', { name: /First/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(tree.getByRole('treeitem', { name: /Second/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      client(page).getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Second');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await expect(tree.getByRole('treeitem', { name: /First/ })).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no axe violations in the client (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await openClient(page);
      await address(client(page)).fill(`${MOCK}/api/v3/pet/1`);
      await client(page).getByRole('button', { name: /^Save$/ }).click();
      await client(page).getByRole('button', { name: 'Add a header' }).click();
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
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

test.describe('the client from an endpoint page', () => {
  test.describe.configure({ mode: 'serial' });

  test('saves what the playground holds, without the credential', async ({
    page,
  }) => {
    await open(page, '/api-reference/pet/getpetbyid');
    await page.getByLabel('petId').fill('1');
    await page.getByRole('tab', { name: 'Authorization' }).click();
    await page.getByLabel(/api_key: API key/).fill(SECRET);

    await page.getByRole('button', { name: 'Save request' }).click();
    const panel = page.getByRole('dialog', { name: 'API client' });
    await expect(address(panel)).toHaveValue(/\/pet\/1$/);
    await panel.getByRole('button', { name: /^Save$/ }).click();
    await expect(panel.getByTestId('api-client-note')).toContainText(
      'api_key was left out',
    );
    // The key is where the playground keeps it, in this tab, and in nothing the client stored.
    const stored = JSON.parse(await storedText(page)) as {
      local: Record<string, string>;
      session: Record<string, string>;
      records: unknown[];
    };
    expect(JSON.stringify(stored.records)).not.toContain(SECRET);
    expect(JSON.stringify(stored.local)).not.toContain(SECRET);
    expect(JSON.stringify(stored.session)).toContain(SECRET);

    // The saved request is listed in the client too: one store for the whole site.
    await openClient(page);
    await expect(
      page
        .getByRole('tree', { name: 'Collections' })
        .getByRole('treeitem', { name: /Find pet/ }),
    ).toBeVisible();
  });

  test('an environment chosen on one page is used by the other', async ({
    page,
    request,
  }) => {
    await request.delete(`${MOCK}/__calls`);
    await openClient(page);
    await makeEnvironment(page);

    await open(page, '/api-reference/pet/getpetbyid');
    await expect(page.getByLabel('Environment')).toHaveValue(/.+/);
    await page.getByLabel('Base URL').fill('{{baseUrl}}');
    await page.getByLabel('petId').fill('1');
    await page.getByRole('tab', { name: 'Authorization' }).click();
    const key = page.getByLabel(/api_key: API key/);
    await key.fill('{{key}}');
    // Wait for the field to be what was typed: the tab may still be restoring what it held.
    await expect(key).toHaveValue('{{key}}');

    // The samples on the page show the variable; the value behind it is never printed on a docs page.
    const samples = page.locator('.dk-api-samples');
    await expect(samples).toContainText('{{key}}');
    await expect(samples).not.toContainText(SECRET);

    // What is sent has the value in it, and goes only to the API.
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('region', { name: 'Response' })).toContainText(
      '200',
    );
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      headers: Record<string, string>;
    }[];
    expect(calls.at(-1)?.headers.api_key).toBe(SECRET);
  });
});
