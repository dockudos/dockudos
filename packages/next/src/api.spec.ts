import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDocsApi,
  createIndexHandler,
  createSearchHandler,
} from './api.ts';

let root: string;
let cwd: string;

const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://docs.test${path}`, init);
const ctx = (...segments: string[]) => ({
  params: Promise.resolve({ dockudos: segments }),
});

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-api-'));
  await mkdir(join(root, 'docs', 'guides'), { recursive: true });
  await writeFile(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
    }),
  );
  await writeFile(
    join(root, 'docs', 'index.mdx'),
    '---\ntitle: Home\n---\n\nWelcome to Acme.\n',
  );
  await writeFile(
    join(root, 'docs', 'guides', 'auth.mdx'),
    '---\ntitle: Authentication\ndescription: Sign in\n---\n\nIntro.\n\n## API keys\n\nRotate a key every ninety days.\n',
  );
  await writeFile(
    join(root, 'docs', 'hidden.mdx'),
    '---\ntitle: Hidden\nhidden: true\n---\n\nUnlisted but routable.\n',
  );
  await mkdir(join(root, 'docs', 'private'));
  await writeFile(
    join(root, 'docs', 'private', 'secret.mdx'),
    '---\ntitle: Secret\n---\n\nRotate the secret key.\n',
  );
  process.chdir(root);
});
afterEach(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('search handler', () => {
  it('answers hits from the built-in engine', async () => {
    const res = await createSearchHandler()(req('/api/search?q=rotate+key'));
    expect(res.status).toBe(200);
    const { hits } = await res.json();
    expect(hits[0]).toMatchObject({
      url: '/guides/auth#api-keys',
      title: 'Authentication',
    });
  });

  it('never returns hidden or protected pages', async () => {
    const res = await createSearchHandler()(
      req('/api/search?q=secret+routable'),
    );
    const { hits } = await res.json();
    expect(hits).toEqual([]);
  });

  it('honours limit and answers an empty list for a blank query', async () => {
    const res = await createSearchHandler()(req('/api/search?q=&limit=1'));
    expect((await res.json()).hits).toEqual([]);
    const some = await createSearchHandler()(
      req('/api/search?q=a+key+welcome&limit=1'),
    );
    expect((await some.json()).hits.length).toBeLessThanOrEqual(1);
  });

  it('refuses an overlong query with a clear message', async () => {
    const res = await createSearchHandler()(
      req(`/api/search?q=${'x'.repeat(301)}`),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/longer than 300/);
  });
});

describe('index handler', () => {
  it('serves the public pages without vectors, with an ETag', async () => {
    const res = await createIndexHandler()(req('/api/search/index'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages.map((p: { path: string }) => p.path)).toEqual([
      '/',
      '/guides/auth',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/vector|Unlisted|secret/);
    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(res.headers.get('cache-control')).toContain('max-age');

    const again = await createIndexHandler()(
      req('/api/search/index', {
        headers: { 'if-none-match': etag as string },
      }),
    );
    expect(again.status).toBe(304);
  });
});

describe('createDocsApi', () => {
  const api = createDocsApi();

  it('routes search, index and page', async () => {
    expect(
      (await api.GET(req('/api/search?q=welcome'), ctx('search'))).status,
    ).toBe(200);
    expect(
      (await api.GET(req('/api/search/index'), ctx('search', 'index'))).status,
    ).toBe(200);
    const page = await api.GET(req('/api/page?path=/guides/auth'), ctx('page'));
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body).toMatchObject({
      path: '/guides/auth',
      title: 'Authentication',
      description: 'Sign in',
      headings: [{ id: 'api-keys', text: 'API keys', depth: 2 }],
    });
    expect(body.markdown).toContain('Rotate a key every ninety days.');
  });

  it('serves hidden pages by path but refuses protected ones and unknown ones', async () => {
    const hidden = await api.GET(req('/api/page?path=/hidden'), ctx('page'));
    expect(hidden.status).toBe(200);
    const secret = await api.GET(
      req('/api/page?path=/private/secret'),
      ctx('page'),
    );
    expect(secret.status).toBe(404);
    const missing = await api.GET(req('/api/page?path=/nope'), ctx('page'));
    expect(missing.status).toBe(404);
    const none = await api.GET(req('/api/page'), ctx('page'));
    expect(none.status).toBe(400);
  });

  it('answers 404 JSON for unknown endpoints and methods', async () => {
    const res = await api.GET(req('/api/nope'), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();
    expect(
      (await api.POST(req('/api/search', { method: 'POST' }), ctx('search')))
        .status,
    ).toBe(404);
  });
});

describe('createDocsApi: a handler that fails', () => {
  it('answers 500 and logs, instead of throwing', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await writeFile(join(root, 'docs.json'), '{ not json');
    const res = await createDocsApi().GET(req('/api/page?path=/'), ctx('page'));
    error.mockRestore();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Something went wrong.');
  });
});
