import { parseConfig } from './config.ts';
import { buildPageTree } from './page-tree.ts';
import { buildRobots, buildSitemap, canonicalUrl, pageSeo } from './seo.ts';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'a&b.mdx', title: 'AB', description: 'About A and B' },
  { file: 'hidden.mdx', title: 'Hidden', hidden: true },
]);
const [home, ab, hidden] = tree.pages as [
  (typeof tree.pages)[0],
  (typeof tree.pages)[0],
  (typeof tree.pages)[0],
];
const withUrl = parseConfig({
  name: 'Acme',
  seo: { siteUrl: 'https://docs.acme.com/', description: 'Default' },
});
const plain = parseConfig({ name: 'Acme' });

describe('canonicalUrl', () => {
  it('joins without doubling slashes', () => {
    expect(canonicalUrl('https://x.dev/', '/a/b')).toBe('https://x.dev/a/b');
    expect(canonicalUrl('https://x.dev', '/')).toBe('https://x.dev/');
  });
});

describe('pageSeo', () => {
  it('builds title, description and canonical', () => {
    expect(pageSeo(withUrl, ab)).toEqual({
      title: 'AB | Acme',
      description: 'About A and B',
      canonical: 'https://docs.acme.com/a&b',
      noindex: false,
    });
  });

  it('uses the site name for home and falls back to the default description', () => {
    expect(pageSeo(withUrl, home)).toMatchObject({
      title: 'Acme',
      description: 'Default',
    });
  });

  it('omits canonical without siteUrl and noindexes hidden pages', () => {
    expect(pageSeo(plain, ab).canonical).toBeUndefined();
    expect(pageSeo(plain, hidden).noindex).toBe(true);
  });

  it('noindexes everything when configured', () => {
    expect(
      pageSeo(parseConfig({ name: 'A', seo: { noindex: true } }), home).noindex,
    ).toBe(true);
  });
});

describe('buildSitemap', () => {
  it('lists visible pages with escaped absolute URLs', () => {
    const xml = buildSitemap(withUrl, tree.pages) as string;
    expect(xml).toContain('<loc>https://docs.acme.com/</loc>');
    expect(xml).toContain('<loc>https://docs.acme.com/a&amp;b</loc>');
    expect(xml).not.toContain('hidden');
  });

  it('adds lastmod when provided', () => {
    const xml = buildSitemap(
      withUrl,
      [home],
      () => new Date('2024-01-02T03:04:05Z'),
    ) as string;
    expect(xml).toContain('<lastmod>2024-01-02T03:04:05.000Z</lastmod>');
  });

  it('is undefined without siteUrl or when noindex', () => {
    expect(buildSitemap(plain, tree.pages)).toBeUndefined();
    expect(
      buildSitemap(
        parseConfig({
          name: 'A',
          seo: { siteUrl: 'https://a.dev', noindex: true },
        }),
        tree.pages,
      ),
    ).toBeUndefined();
  });
});

describe('buildRobots', () => {
  it('allows all and links the sitemap', () => {
    expect(buildRobots(withUrl)).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://docs.acme.com/sitemap.xml\n',
    );
  });

  it('omits the sitemap without siteUrl and disallows on noindex', () => {
    expect(buildRobots(plain)).toBe('User-agent: *\nAllow: /\n');
    expect(
      buildRobots(parseConfig({ name: 'A', seo: { noindex: true } })),
    ).toBe('User-agent: *\nDisallow: /\n');
  });
});
