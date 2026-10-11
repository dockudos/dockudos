import { buildNavigation, buildPageTree, parseConfig } from '@dockudos/core';
import { render, screen, within } from '@testing-library/react';
import { DocsBook } from './docs-book.tsx';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'api/users.mdx', title: 'Users' },
  { file: 'hidden/only.mdx', title: 'Only' },
]);
const config = parseConfig({
  name: 'Acme',
  navigation: [
    {
      tab: 'Docs',
      groups: [
        {
          group: 'Start',
          pages: [
            'index',
            { title: 'GitHub', href: 'https://github.com/acme' },
          ],
        },
        { group: 'Hidden', pages: ['hidden/only'] },
      ],
    },
    { tab: 'API', groups: [{ group: 'Reference', pages: ['api/users'] }] },
  ],
});
const nav = buildNavigation(config, tree);
const sectionsFor = (paths: string[]) =>
  tree.pages
    .filter((p) => paths.includes(p.path))
    .map((page) => ({ page, toc: [], node: <p>Body of {page.title}</p> }));

describe('DocsBook, contents', () => {
  it('names each section when there are several, and skips groups with no page in the book', () => {
    render(
      <DocsBook
        config={config}
        nav={nav}
        sections={sectionsFor(['/', '/api/users'])}
      />,
    );
    const toc = within(screen.getByRole('navigation', { name: 'Contents' }));
    expect(toc.getByRole('heading', { name: 'Docs' })).toBeInTheDocument();
    expect(toc.getByRole('heading', { name: 'API' })).toBeInTheDocument();
    expect(toc.getByText('Start')).toBeInTheDocument();
    expect(toc.queryByText('Only')).toBeNull();
    expect(toc.queryByText('GitHub')).toBeNull();
  });

  it('has no cover date without one, and puts a page outside the navigation under More', () => {
    const loose = buildPageTree([{ file: 'loose.mdx', title: 'Loose' }])
      .pages[0]!;
    render(
      <DocsBook
        config={config}
        nav={nav}
        sections={[
          ...sectionsFor(['/']),
          { page: loose, toc: [], node: <p>x</p> },
        ]}
      />,
    );
    expect(document.querySelector('.dk-book-date')).toBeNull();
    expect(screen.getByRole('heading', { name: 'More' })).toBeInTheDocument();
  });
});
