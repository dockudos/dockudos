import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLlmsFullHandler, createLlmsHandler } from './llms.ts';
import { createMarkdownHandler } from './markdown.ts';

let root: string;
let cwd: string;
const req = (path: string) => new Request(`http://docs.test${path}`);

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-llms-'));
  await mkdir(join(root, 'docs', 'guides'), { recursive: true });
  await mkdir(join(root, 'docs', 'private'));
  await writeFile(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      seo: { siteUrl: 'https://docs.acme.com', description: 'Acme docs.' },
      access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
    }),
  );
  await writeFile(
    join(root, 'docs', 'index.mdx'),
    '---\ntitle: Home\ndescription: Start here\n---\n\nWelcome.\n',
  );
  await writeFile(
    join(root, 'docs', 'guides', 'auth.mdx'),
    '---\ntitle: Authentication\n---\n\n<Visibility for="humans">\nPeople only.\n</Visibility>\n\n<Visibility for="agents">\nAgents only.\n</Visibility>\n\nSign requests with a key.\n',
  );
  await writeFile(
    join(root, 'docs', 'hidden.mdx'),
    '---\ntitle: Hidden page\nhidden: true\n---\n\nQuietly here.\n',
  );
  await writeFile(
    join(root, 'docs', 'private', 'plan.mdx'),
    '---\ntitle: Private plan\n---\n\nSecret roadmap.\n',
  );
  process.chdir(root);
});
afterEach(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('llms.txt', () => {
  it('lists public pages with links to their Markdown twins', async () => {
    const res = await createLlmsHandler()();
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# Acme\n\n> Acme docs.');
    expect(text).toContain(
      '- [Home](https://docs.acme.com/index.md): Start here',
    );
    expect(text).toContain(
      '- [Authentication](https://docs.acme.com/guides/auth.md)',
    );
    expect(text).not.toMatch(/Hidden page|Private plan|private|hidden/);
  });
});

describe('llms-full.txt', () => {
  it('has the text of every public page, for agents, and nothing else', async () => {
    const text = await (await createLlmsFullHandler()()).text();
    expect(text).toContain('Sign requests with a key.');
    expect(text).toContain('Agents only.');
    expect(text).not.toContain('People only.');
    expect(text).toContain('Source: https://docs.acme.com/guides/auth');
    expect(text).not.toMatch(/Quietly here|Secret roadmap/);
  });
});

describe('Markdown twins', () => {
  const GET = createMarkdownHandler();

  it('serves a page, and the home page as /index, as Markdown', async () => {
    const page = await GET(req('/api/markdown?path=/guides/auth'));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(page.headers.get('vary')).toBe('Accept');
    expect(await page.text()).toContain('# Authentication');

    const home = await GET(req('/api/markdown?path=/index'));
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Welcome.');
  });

  it('reads the address the request was made to, as a rewrite leaves it', async () => {
    const twin = await GET(req('/guides/auth.md'));
    expect(await twin.text()).toContain('# Authentication');
    expect(await (await GET(req('/index.md'))).text()).toContain('Welcome.');
    expect(await (await GET(req('/guides/auth/'))).text()).toContain(
      '# Authentication',
    );
    expect((await GET(req('/private/plan.md'))).status).toBe(404);
    expect((await GET(req('/nope.md'))).status).toBe(404);
  });

  it('serves hidden pages by address but not protected ones', async () => {
    expect((await GET(req('/api/markdown?path=/hidden'))).status).toBe(200);
    expect((await GET(req('/api/markdown?path=/private/plan'))).status).toBe(
      404,
    );
    expect((await GET(req('/api/markdown?path=/nope'))).status).toBe(404);
    expect((await GET(req('/api/markdown'))).status).toBe(404);
  });
});
