import { buildNavigation, buildPageTree, parseConfig } from '@dockudos/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DocsBook } from './docs-book.tsx';
import { bookKey } from './book-key.ts';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'guides/auth.mdx', title: 'Auth', description: 'Sign requests.' },
  { file: 'loose.mdx', title: 'Loose' },
]);
const config = parseConfig({
  name: 'Acme',
  navigation: [
    {
      tab: 'Docs',
      groups: [{ group: 'Start', pages: ['index', 'guides/auth'] }],
    },
    { tab: 'Blog', href: 'https://blog.acme.dev' },
  ],
});
const nav = buildNavigation(config, tree);
const sections = tree.pages.map((page) => ({
  page,
  toc: [],
  node: <p>Body of {page.title}</p>,
}));

function setup() {
  return render(
    <DocsBook
      config={config}
      nav={nav}
      sections={sections}
      generatedAt={new Date('2026-03-05T10:00:00Z')}
    />,
  );
}

describe('bookKey', () => {
  it('makes an element id from a page path', () => {
    expect(bookKey('/')).toBe('doc-home');
    expect(bookKey('/guides/auth')).toBe('doc-guides-auth');
    expect(bookKey('/docs/a b/')).toBe('doc-docs-a-b');
  });
});

describe('DocsBook', () => {
  it('has a cover with the site name and the date', () => {
    setup();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Acme' }),
    ).toBeInTheDocument();
    expect(screen.getByText('March 5, 2026')).toHaveAttribute(
      'datetime',
      '2026-03-05T10:00:00.000Z',
    );
  });

  it('lists every page in a table of contents that links to its section', () => {
    setup();
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    expect(within(toc).getByRole('link', { name: 'Auth' })).toHaveAttribute(
      'href',
      '#doc-guides-auth',
    );
    expect(within(toc).getByText('Start')).toBeInTheDocument();
    // A page the navigation does not list goes under "More".
    expect(within(toc).getByText('More')).toBeInTheDocument();
    expect(
      within(toc).getByRole('link', { name: 'Loose' }),
    ).toBeInTheDocument();
    // An external-link tab has no pages, so it is not a section of the book.
    expect(within(toc).queryByText('Blog')).not.toBeInTheDocument();
  });

  it('renders each page as a section with its title, description and content', () => {
    const { container } = setup();
    const auth = container.querySelector('#doc-guides-auth')!;
    expect(auth).toHaveAttribute('data-book-path', '/guides/auth');
    expect(
      within(auth as HTMLElement).getByRole('heading', {
        level: 1,
        name: 'Auth',
      }),
    ).toBeInTheDocument();
    expect(
      within(auth as HTMLElement).getByText('Sign requests.'),
    ).toBeInTheDocument();
    expect(
      within(auth as HTMLElement).getByText('Body of Auth'),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-book-path]')).toHaveLength(3);
  });

  it('skips contents entries for pages that are not in the book', () => {
    render(
      <DocsBook config={config} nav={nav} sections={sections.slice(0, 1)} />,
    );
    expect(
      screen.queryByRole('link', { name: 'Auth' }),
    ).not.toBeInTheDocument();
  });
});

describe('BookLinks', () => {
  afterEach(() => {
    cleanup();
    document.body.removeAttribute('data-book-ready');
  });

  it('gives headings page-unique ids and points links at them, then says it is ready', () => {
    const withLinks = tree.pages.map((page) => ({
      page,
      toc: [],
      node: (
        <>
          <h2 id="setup">Setup</h2>
          <a href="#setup">same page</a>
          <a href="/guides/auth#keys">other page</a>
          <a href="/">home</a>
          <a href="/not-in-book">outside</a>
          <a href="https://example.com/x">external</a>
        </>
      ),
    }));
    const { container } = render(
      <DocsBook config={config} nav={nav} sections={withLinks} />,
    );
    const auth = container.querySelector('#doc-guides-auth')!;
    expect(auth.querySelector('h2')).toHaveAttribute(
      'id',
      'doc-guides-auth--setup',
    );
    expect(container.querySelector('#doc-home h2')).toHaveAttribute(
      'id',
      'doc-home--setup',
    );
    const hrefs = [...auth.querySelectorAll('.dk-prose a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '#doc-guides-auth--setup',
      '#doc-guides-auth--keys',
      '#doc-home',
      '/not-in-book',
      'https://example.com/x',
    ]);
    expect(document.body.dataset['bookReady']).toBe('1');
  });
});
