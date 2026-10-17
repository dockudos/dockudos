import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The real thing: `dockudos edit` on a throwaway Git repository, driven in a browser.
const BIN = join(import.meta.dirname, '../../../packages/cli/dist/bin.js');
let dir: string;
let child: ChildProcess;
let url: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dkd-e2e-edit-'));
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(
    join(dir, 'docs.json'),
    JSON.stringify(
      {
        name: 'Acme',
        navigation: [
          {
            tab: 'Docs',
            groups: [{ group: 'Start', pages: ['index', 'guide'] }],
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(dir, 'docs/index.mdx'),
    '---\ntitle: Home\n---\n\n# Welcome\n\nThe first paragraph.\n\nThe second paragraph.\n',
  );
  await writeFile(
    join(dir, 'docs/guide.mdx'),
    '---\ntitle: Guide\n---\n\nimport X from "./x";\n\n<Callout type="info">\n\nKeep **this**.\n\n</Callout>\n\nSee {1 + 1} and <Kbd>Esc</Kbd>.\n',
  );
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada');
  git('config', 'user.email', 'ada@example.com');
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial docs');

  child = spawn(
    process.execPath,
    [BIN, 'edit', dir, '--no-open', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  url = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/.exec(out);
      if (m) resolve(m[0]);
    });
    child.once('exit', () => reject(new Error(`edit exited: ${out}`)));
  });
});

test.afterAll(async () => {
  child.kill();
  await rm(dir, { recursive: true, force: true });
});

const saved = (page: import('@playwright/test').Page) =>
  expect(
    page.getByRole('status').filter({ hasText: /Saved to disk/ }),
  ).toBeVisible();

test('opens the folder, edits visually, saves to disk and commits with Git', async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: /guide/ }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'index', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'docs/index.mdx' }),
  ).toBeVisible();

  await page.getByText('The first paragraph.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edited in the browser.');
  await expect(page.getByRole('status').filter({ hasText: 'Saving' }))
    .toBeVisible()
    .catch(() => undefined);
  await saved(page);

  // Only the edited paragraph changed on disk.
  const text = await readFile(join(dir, 'docs/index.mdx'), 'utf8');
  expect(text).toBe(
    '---\ntitle: Home\n---\n\n# Welcome\n\nThe first paragraph. Edited in the browser.\n\nThe second paragraph.\n',
  );

  const panel = page.getByRole('complementary', { name: 'Changes' });
  await expect(panel.getByText('Edited')).toBeVisible();
  await panel.getByRole('button', { name: 'Diff' }).click();
  await expect(panel.getByLabel('Changes in docs/index.mdx')).toContainText(
    '+The first paragraph. Edited in the browser.',
  );

  await panel.getByLabel('Commit message').fill('Reword the first paragraph');
  await panel.getByRole('button', { name: /^Commit/ }).click();
  await expect(panel.getByText(/Committed 1 file/)).toBeVisible();
  await expect(panel.getByText('Nothing to commit')).toBeVisible();
  expect(git('log', '-1', '--format=%s|%an')).toBe(
    'Reword the first paragraph|Ada\n',
  );
  expect(git('status', '--porcelain')).toBe('');
});

test('formats text and inserts a component, keeping what the editor cannot show', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'guide', exact: true }).click();
  // The import, the expression and the inline tag are all kept as written.
  await expect(page.getByLabel('Source').first()).toHaveValue(
    'import X from "./x";',
  );
  await expect(page.getByLabel('Callout tag')).toHaveValue(
    '<Callout type="info">',
  );

  await page.getByText('Keep').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And more.');
  await page.getByLabel('Insert component').selectOption('Steps');
  await saved(page);

  const text = await readFile(join(dir, 'docs/guide.mdx'), 'utf8');
  expect(text).toContain('import X from "./x";');
  expect(text).toContain('Keep **this**. And more.');
  expect(text).toContain('<Steps>');
  expect(text).toContain('See {1 + 1} and <Kbd>Esc</Kbd>.');
  git('checkout', '--', '.');
});

test('creates a page, lists it in the sidebar and adds it to docs.json', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('button', { name: '+ New page' }).click();
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByLabel('Title')
    .fill('Getting Started');
  await expect(page.getByLabel('Address')).toHaveValue('getting-started');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByRole('heading', { name: 'docs/getting-started.mdx' }),
  ).toBeVisible();

  await page.locator('.prose').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Hello from a new page.');
  await saved(page);

  expect(
    await readFile(join(dir, 'docs/getting-started.mdx'), 'utf8'),
  ).toContain('Hello from a new page.');
  expect(
    JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).navigation[0]
      .groups[0].pages,
  ).toContain('getting-started');

  const panel = page.getByRole('complementary', { name: 'Changes' });
  await expect(panel.getByText('New')).toBeVisible();
  await panel.getByLabel('Commit message').fill('Add Getting Started');
  await panel.getByRole('button', { name: /^Commit 2 files/ }).click();
  await expect(panel.getByText(/Committed 2 files/)).toBeVisible();
  expect(git('ls-files')).toContain('docs/getting-started.mdx');
});

test('source view round-trips and reports invalid MDX instead of losing it', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'index', exact: true }).click();
  await page.getByRole('button', { name: 'Source' }).click();
  const src = page.getByLabel('MDX source');
  await expect(src).toHaveValue(/# Welcome/);
  await src.fill('---\ntitle: Home\n---\n\n<Unclosed>\n');
  await page.getByRole('button', { name: 'Visual' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Cannot switch to Visual' }),
  ).toBeVisible();
  await src.fill('---\ntitle: Home\n---\n\n# Back to fine\n');
  await page.getByRole('button', { name: 'Visual' }).click();
  await expect(
    page.getByRole('heading', { name: 'Back to fine' }),
  ).toBeVisible();
  await saved(page);
  git('checkout', '--', '.');
});

test('refuses to be used without the launch token', async ({ request }) => {
  const origin = new URL(url).origin;
  expect((await request.get(`${origin}/api/project`)).status()).toBe(401);
});

test('has no accessibility violations', async ({ page }) => {
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: 'index', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'editor-screenshot.png') });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual(
    [],
  );
  expect(existsSync(dir)).toBe(true);
});
