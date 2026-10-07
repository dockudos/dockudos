import { extractLinks, resolveDocLink } from './links.ts';

const at = 'guides/auth.mdx';

describe('resolveDocLink', () => {
  it.each([
    'https://x.dev/a',
    'http://x.dev',
    'mailto:a@b.c',
    'tel:123',
    '//cdn.x.dev/a',
  ])('treats %s as external', (href) =>
    expect(resolveDocLink(at, href)).toEqual({ kind: 'external', href }),
  );

  it('recognises same-page anchors', () => {
    expect(resolveDocLink(at, '#setup')).toEqual({
      kind: 'anchor',
      hash: 'setup',
    });
  });

  it('resolves relative page links, dropping the extension', () => {
    expect(resolveDocLink(at, './other.mdx')).toEqual({
      kind: 'internal',
      path: '/guides/other',
    });
    expect(resolveDocLink(at, '../start.md#install')).toEqual({
      kind: 'internal',
      path: '/start',
      hash: 'install',
    });
    expect(resolveDocLink(at, 'sub/page')).toEqual({
      kind: 'internal',
      path: '/guides/sub/page',
    });
  });

  it('maps index files to their folder', () => {
    expect(resolveDocLink(at, './index.mdx')).toEqual({
      kind: 'internal',
      path: '/guides',
    });
    expect(resolveDocLink(at, '../index.mdx')).toEqual({
      kind: 'internal',
      path: '/',
    });
  });

  it('keeps absolute site paths and strips query strings', () => {
    expect(resolveDocLink(at, '/api/users?x=1#top')).toEqual({
      kind: 'internal',
      path: '/api/users',
      hash: 'top',
    });
    expect(resolveDocLink(at, '/')).toEqual({ kind: 'internal', path: '/' });
  });

  it('does not climb above the docs root', () => {
    expect(resolveDocLink(at, '../../../x.mdx')).toEqual({
      kind: 'internal',
      path: '/x',
    });
  });

  it('classifies non-page files as assets', () => {
    expect(resolveDocLink(at, './diagram.png')).toEqual({
      kind: 'asset',
      href: './diagram.png',
    });
    expect(resolveDocLink(at, '/files/a.pdf')).toEqual({
      kind: 'asset',
      href: '/files/a.pdf',
    });
  });

  it('applies the same URL-safe segments as the page tree', () => {
    expect(resolveDocLink('a.mdx', './My%20Page.mdx')).toEqual({
      kind: 'internal',
      path: '/My-Page',
    });
  });
});

describe('extractLinks', () => {
  it('finds inline links and images with line numbers', () => {
    const src = [
      '# T',
      '',
      'See [a](./a.mdx#x) and ![logo](/img/logo.png "Logo").',
      '[b](https://x.dev)',
    ].join('\n');
    expect(extractLinks(src)).toEqual([
      { href: './a.mdx#x', line: 3, kind: 'link' },
      { href: '/img/logo.png', line: 3, kind: 'image' },
      { href: 'https://x.dev', line: 4, kind: 'link' },
    ]);
  });

  it('finds reference definitions and JSX/HTML attributes', () => {
    const src = [
      '[ref]: ./r.mdx',
      '<Card href="/guides/x" title="X" />',
      "<img src='/a.png' alt='' />",
    ].join('\n');
    expect(extractLinks(src)).toEqual([
      { href: './r.mdx', line: 1, kind: 'link' },
      { href: '/guides/x', line: 2, kind: 'link' },
      { href: '/a.png', line: 3, kind: 'image' },
    ]);
  });

  it('skips code fences and inline code', () => {
    const src = [
      '```md',
      '[no](./nope.mdx)',
      '```',
      'Use `[no](./nope2.mdx)` literally, but [yes](./yes.mdx).',
    ].join('\n');
    expect(extractLinks(src).map((l) => l.href)).toEqual(['./yes.mdx']);
  });

  it('supports angle-bracket destinations and counts frontmatter lines', () => {
    const src = ['---', 'title: T', '---', '[x](<./a b.mdx>)'].join('\n');
    expect(extractLinks(src)).toEqual([
      { href: './a b.mdx', line: 4, kind: 'link' },
    ]);
  });
});
