import { buildPageTree } from './page-tree.ts';

const files = [
  'quickstart.mdx',
  'index.mdx',
  'guides/webhooks.mdx',
  'guides/index.mdx',
  'guides/auth.mdx',
  'guides/deep/nested-page.md',
  'a-file.mdx',
  'image.png',
];

describe('buildPageTree', () => {
  const tree = buildPageTree(files);

  it('maps files to URL paths', () => {
    expect(tree.pages.map((p) => p.path)).toEqual([
      '/',
      '/a-file',
      '/quickstart',
      '/guides',
      '/guides/auth',
      '/guides/webhooks',
      '/guides/deep/nested-page',
    ]);
  });

  it('ignores non-markdown files', () => {
    expect(tree.pages.some((p) => p.file.endsWith('.png'))).toBe(false);
  });

  it('puts the root index first and exposes it', () => {
    expect(tree.index?.path).toBe('/');
    expect(tree.pages[0]).toBe(tree.index);
    expect(tree.index?.slug).toEqual([]);
  });

  it('lists pages before folders, each alphabetical', () => {
    expect(
      tree.children.map((c) => (c.type === 'page' ? c.path : c.name)),
    ).toEqual(['/a-file', '/quickstart', 'guides']);
  });

  it('attaches a folder index to its folder', () => {
    const guides = tree.children.find((c) => c.type === 'folder');
    expect(guides?.type === 'folder' && guides.index?.path).toBe('/guides');
    expect(guides?.type === 'folder' && guides.path).toBe('/guides');
  });

  it('derives titles from file names', () => {
    const byPath = Object.fromEntries(tree.pages.map((p) => [p.path, p.title]));
    expect(byPath['/']).toBe('Home');
    expect(byPath['/guides']).toBe('Guides');
    expect(byPath['/guides/deep/nested-page']).toBe('Nested page');
  });

  it('keeps the source file with forward slashes', () => {
    const page = buildPageTree(['guides\\auth.mdx']).pages[0];
    expect(page.file).toBe('guides/auth.mdx');
    expect(page.path).toBe('/guides/auth');
  });

  it('is independent of input order', () => {
    expect(buildPageTree([...files].reverse())).toEqual(tree);
  });

  it('handles an empty folder list', () => {
    expect(buildPageTree([])).toEqual({
      index: undefined,
      children: [],
      pages: [],
    });
  });
});
