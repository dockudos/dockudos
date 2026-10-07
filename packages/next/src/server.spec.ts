import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSite,
  pageMetadata,
  robotsResponse,
  siteMetadata,
  sitemapResponse,
} from './server.ts';

let root: string;
const config = (extra = {}) =>
  writeFile(
    join(root, 'docs.json'),
    JSON.stringify({ name: 'Acme', ...extra }),
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-server-'));
  await mkdir(join(root, 'docs', 'guides'), { recursive: true });
  await writeFile(
    join(root, 'docs', 'index.mdx'),
    '---\ndescription: Welcome\n---\n# Home',
  );
  await writeFile(join(root, 'docs', 'guides', 'auth.mdx'), '# Auth');
  await writeFile(
    join(root, 'docs', 'secret.mdx'),
    '---\nhidden: true\n---\n# Secret',
  );
  await config({
    seo: { siteUrl: 'https://docs.acme.com' },
    favicon: '/f.ico',
  });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('getSite', () => {
  it('loads config, tree and navigation, and finds pages by slug', async () => {
    const site = await getSite({ root });
    expect(site.config.name).toBe('Acme');
    expect(site.find()?.path).toBe('/');
    expect(site.find(['guides', 'auth'])?.title).toBe('Auth');
    expect(site.find(['nope'])).toBeUndefined();
    expect(site.nav.tabs).toHaveLength(1);
  });

  it('re-reads files outside production so edits show up', async () => {
    expect((await getSite({ root })).config.name).toBe('Acme');
    await config({ name: 'Renamed' });
    expect((await getSite({ root })).config.name).toBe('Renamed');
  });

  it('caches in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const a = await getSite({ root });
      await config({ name: 'Renamed' });
      expect(await getSite({ root })).toBe(a);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reports the file system time when not in Git', async () => {
    const site = await getSite({ root });
    expect(
      (await site.lastModified(site.find() as never)).getTime(),
    ).toBeGreaterThan(0);
  });
});

describe('metadata', () => {
  it('builds site metadata', async () => {
    const meta = siteMetadata(await getSite({ root }));
    expect(String(meta.metadataBase)).toBe('https://docs.acme.com/');
    expect(meta.icons).toEqual({ icon: '/f.ico' });
  });

  it('builds page metadata with canonical and noindex for hidden pages', async () => {
    const site = await getSite({ root });
    expect(pageMetadata(site, site.find(['guides', 'auth']) as never)).toEqual({
      title: { absolute: 'Auth | Acme' },
      alternates: { canonical: 'https://docs.acme.com/guides/auth' },
    });
    const home = pageMetadata(site, site.find() as never);
    expect(home.description).toBe('Welcome');
    expect(pageMetadata(site, site.find(['secret']) as never).robots).toEqual({
      index: false,
      follow: false,
    });
  });
});

describe('sitemap and robots', () => {
  it('serves a sitemap of visible pages', async () => {
    const res = await sitemapResponse(await getSite({ root }));
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>https://docs.acme.com/guides/auth</loc>');
    expect(xml).toContain('<lastmod>');
    expect(xml).not.toContain('secret');
  });

  it('404s without siteUrl', async () => {
    await config();
    expect((await sitemapResponse(await getSite({ root }))).status).toBe(404);
  });

  it('serves robots.txt pointing at the sitemap', async () => {
    const text = await (await robotsResponse(await getSite({ root }))).text();
    expect(text).toContain('Sitemap: https://docs.acme.com/sitemap.xml');
  });
});

it('uses git dates for committed files', async () => {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'x',
    ],
    {
      cwd: root,
      env: { ...process.env, GIT_COMMITTER_DATE: '2020-02-02T00:00:00Z' },
    },
  );
  const site = await getSite({ root });
  expect((await site.lastModified(site.find() as never)).toISOString()).toBe(
    '2020-02-02T00:00:00.000Z',
  );
});
