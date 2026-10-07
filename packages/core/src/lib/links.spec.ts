import { resolveDocLink } from './links.ts';

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
