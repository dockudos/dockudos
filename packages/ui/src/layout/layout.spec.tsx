import {
  type Navigation,
  buildNavigation,
  buildPageTree,
  parseConfig,
} from '@dockudos/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { GraphView } from '../components/graph-view.tsx';
import { InlineToc } from '../components/inline-toc.tsx';
import { layoutGraph } from '../lib/graph-layout.ts';
import { DocsLayout } from './docs-layout.tsx';
import { Sidebar } from './sidebar.tsx';
import { useActiveHeading } from './toc.tsx';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'start.mdx', title: 'Start', description: 'Begin here' },
  { file: 'guides/auth.mdx', title: 'Auth' },
  { file: 'guides/deep/page.mdx', title: 'Deep page', sidebarTitle: 'Deep' },
  { file: 'api/users.mdx', title: 'Users' },
]);
const config = parseConfig({
  name: 'Acme',
  logo: { light: '/l.svg', dark: '/d.svg' },
  navigation: [
    {
      tab: 'Docs',
      groups: [
        {
          group: 'Basics',
          pages: [
            'index',
            'start',
            {
              group: 'Guides',
              pages: [
                'guides/auth',
                { group: 'Deep', pages: ['guides/deep/page'] },
              ],
            },
            { title: 'GitHub', href: 'https://github.com/acme' },
          ],
        },
      ],
    },
    { tab: 'API', groups: [{ group: 'Reference', pages: ['api/users'] }] },
    { tab: 'Blog', href: 'https://blog.acme.dev' },
  ],
});
const nav: Navigation = buildNavigation(config, tree);
const page = (path: string) => tree.pages.find((p) => p.path === path)!;

describe('Sidebar', () => {
  const items = nav.tabs[0]!.sidebar;

  it('marks the current page and only that page', () => {
    render(<Sidebar items={items} path="/guides/auth" />);
    const current = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['Auth']);
  });

  it('opens the group that holds the current page and collapses the others', () => {
    render(<Sidebar items={items} path="/guides/deep/page" />);
    const nested = screen.getByText('Guides').closest('details')!;
    const deepest = screen
      .getByText('Deep', { selector: 'summary' })
      .closest('details')!;
    expect(nested.open).toBe(true);
    expect(deepest.open).toBe(true);
  });

  it('collapses nested groups that do not hold the current page', () => {
    render(<Sidebar items={items} path="/start" />);
    expect(
      screen.getByText('Guides', { selector: 'summary' }).closest('details')!
        .open,
    ).toBe(false);
  });

  it('groups open and close on activation', async () => {
    const user = userEvent.setup();
    render(<Sidebar items={items} path="/start" />);
    const summary = screen.getByText('Guides', { selector: 'summary' });
    await user.click(summary);
    expect(summary.closest('details')!.open).toBe(true);
    await user.click(summary);
    expect(summary.closest('details')!.open).toBe(false);
  });

  it('uses the sidebar title and opens external links safely', () => {
    render(<Sidebar items={items} path="/start" />);
    expect(screen.getByRole('link', { name: 'Deep' })).toHaveAttribute(
      'href',
      '/guides/deep/page',
    );
    const external = screen.getByRole('link', { name: /GitHub/ });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute(
      'rel',
      expect.stringContaining('noopener'),
    );
  });
});

describe('DocsLayout', () => {
  const props = (path: string) => ({
    config,
    nav,
    page: page(path),
    toc: [
      { id: 'one', text: 'One', depth: 2 },
      { id: 'two', text: 'Two', depth: 3 },
    ],
  });

  it('renders the frame with skip link, title, description, toc and landmarks', () => {
    render(<DocsLayout {...props('/start')}>Body text</DocsLayout>);
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#dk-content');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Start' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Begin here')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'dk-content');
    expect(
      screen.getByRole('navigation', { name: 'On this page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Two' })).toHaveAttribute(
      'href',
      '#two',
    );
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('shows the sidebar of the tab holding the page, tab links in the navbar, external tab last', () => {
    render(<DocsLayout {...props('/api/users')}>x</DocsLayout>);
    const sections = screen.getAllByRole('navigation', {
      name: 'Sections',
    })[0]!;
    expect(
      within(sections)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Docs', 'API', 'Blog (opens in a new tab)']);
    expect(within(sections).getByRole('link', { name: 'API' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    expect(
      within(sidebar).getByRole('link', { name: 'Users' }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('link', { name: 'Start' }),
    ).not.toBeInTheDocument();
  });

  it('renders breadcrumb and previous/next links', () => {
    render(<DocsLayout {...props('/start')}>x</DocsLayout>);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Start')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const pager = screen.getByRole('navigation', {
      name: 'Previous and next pages',
    });
    expect(within(pager).getByRole('link', { name: /Home/ })).toHaveAttribute(
      'rel',
      'prev',
    );
    expect(within(pager).getByRole('link', { name: /Auth/ })).toHaveAttribute(
      'rel',
      'next',
    );
  });

  it('shows the last updated date when given', () => {
    render(
      <DocsLayout
        {...props('/start')}
        lastModified={new Date('2024-03-05T10:00:00Z')}
      >
        x
      </DocsLayout>,
    );
    const time = screen.getByText('March 5, 2024');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2024-03-05T10:00:00.000Z');
  });

  it.each(['docs', 'notebook', 'spacious', 'flux', 'glass', 'home'] as const)(
    'applies the %s layout from theme.layout',
    (layout) => {
      const c = parseConfig({ name: 'A', theme: { layout } });
      const { container } = render(
        <DocsLayout {...props('/start')} config={c}>
          x
        </DocsLayout>,
      );
      expect(container.querySelector('.dk-shell')).toHaveAttribute(
        'data-layout',
        layout,
      );
    },
  );

  it('lets a page override the layout', () => {
    const p = { ...page('/'), layout: 'home' as const };
    const { container } = render(
      <DocsLayout {...props('/')} page={p}>
        x
      </DocsLayout>,
    );
    expect(container.querySelector('.dk-shell')).toHaveAttribute(
      'data-layout',
      'home',
    );
  });

  it('falls back to the first tab sidebar for pages outside the navigation', () => {
    const loose = buildPageTree([{ file: 'orphan.mdx', title: 'Orphan' }])
      .pages[0]!;
    render(
      <DocsLayout {...props('/')} page={loose}>
        x
      </DocsLayout>,
    );
    expect(
      within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole(
        'link',
        { name: 'Home' },
      ),
    ).toBeInTheDocument();
  });
});

describe('mobile drawer', () => {
  it('opens from the menu button, shows navigation, closes on Escape and on following a link', async () => {
    const user = userEvent.setup();
    render(
      <DocsLayout config={config} nav={nav} page={page('/start')} toc={[]}>
        x
      </DocsLayout>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('link', { name: 'Auth' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('link', {
        name: 'Home',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('useActiveHeading', () => {
  type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
  let callback: Callback;
  const observed: Element[] = [];

  beforeEach(() => {
    observed.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: Callback) {
          callback = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect = () => undefined;
      },
    );
    document.body.innerHTML =
      '<h2 id="a"></h2><h2 id="b"></h2><h2 id="c"></h2>';
  });
  afterEach(() => vi.unstubAllGlobals());

  function Probe({ ids }: { ids: string[] }) {
    return <output>{useActiveHeading(ids)}</output>;
  }

  it('starts on the first heading and follows the topmost visible one', () => {
    render(<Probe ids={['a', 'b', 'c']} />, {
      container: document.body.appendChild(document.createElement('div')),
    });
    expect(screen.getByRole('status')).toHaveTextContent('a');
    expect(observed.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    act(() =>
      callback([
        { target: document.getElementById('c')!, isIntersecting: true },
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent('c');
    act(() =>
      callback([
        { target: document.getElementById('b')!, isIntersecting: true },
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent('b');
  });

  it('keeps the last active heading when none is visible', () => {
    render(<Probe ids={['a', 'b']} />, {
      container: document.body.appendChild(document.createElement('div')),
    });
    act(() =>
      callback([
        { target: document.getElementById('b')!, isIntersecting: true },
      ]),
    );
    act(() =>
      callback([
        { target: document.getElementById('b')!, isIntersecting: false },
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent('b');
  });
});

describe('InlineToc and GraphView', () => {
  it('InlineToc lists entries with indentation by depth', () => {
    render(
      <InlineToc
        items={[
          { id: 'a', text: 'A', depth: 2 },
          { id: 'b', text: 'B', depth: 3 },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute(
      'href',
      '#b',
    );
  });

  it('InlineToc renders nothing without entries', () => {
    const { container } = render(<InlineToc items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('GraphView draws every page as a link', () => {
    render(
      <GraphView
        data={{
          nodes: [
            { id: '/a', title: 'A', path: '/a' },
            { id: '/b', title: 'B', path: '/b' },
          ],
          edges: [{ from: '/a', to: '/b' }],
        }}
      />,
    );
    expect(
      screen.getByRole('group', { name: /Graph of pages/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link').map((l) => l.getAttribute('href')),
    ).toEqual(['/a', '/b']);
    expect(document.querySelectorAll('line')).toHaveLength(1);
  });
});

describe('layoutGraph', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ];

  it('is deterministic and keeps nodes inside the box', () => {
    const one = layoutGraph(ids, edges, 600);
    expect(layoutGraph(ids, edges, 600)).toEqual(one);
    for (const p of one) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(600);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });

  it('pulls linked nodes closer than unlinked ones', () => {
    const p = Object.fromEntries(layoutGraph(ids, edges).map((n) => [n.id, n]));
    const d = (a: string, b: string) =>
      Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);
    expect(d('a', 'b')).toBeLessThan(d('a', 'd'));
  });

  it('handles empty, single and duplicate-edge input', () => {
    expect(layoutGraph([], [])).toEqual([]);
    expect(layoutGraph(['x'], [])).toEqual([{ id: 'x', x: 300, y: 300 }]);
    expect(() =>
      layoutGraph(
        ['a', 'b'],
        [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'b' },
          { from: 'a', to: 'zzz' },
        ],
      ),
    ).not.toThrow();
  });
});

describe('DocsLayout: kudos and brand', () => {
  const base = { nav, page: page('/start'), toc: [] };

  it('shows the kudos widget only when enabled, and not on pages that opt out', () => {
    const off = render(
      <DocsLayout {...base} config={config}>
        x
      </DocsLayout>,
    );
    expect(
      screen.queryByRole('heading', { name: 'Was this page helpful?' }),
    ).not.toBeInTheDocument();
    off.unmount();
    const on = parseConfig({ name: 'A', kudos: { enabled: true } });
    const view = render(
      <DocsLayout {...base} config={on}>
        x
      </DocsLayout>,
    );
    expect(
      screen.getByRole('heading', { name: 'Was this page helpful?' }),
    ).toBeInTheDocument();
    view.unmount();
    render(
      <DocsLayout {...base} page={{ ...base.page, kudos: false }} config={on}>
        x
      </DocsLayout>,
    );
    expect(
      screen.queryByRole('heading', { name: 'Was this page helpful?' }),
    ).not.toBeInTheDocument();
  });

  it('replaces the logo and name with a custom brand', () => {
    render(
      <DocsLayout
        {...base}
        config={config}
        brand={<b data-testid="brand">B</b>}
      >
        x
      </DocsLayout>,
    );
    expect(screen.getByTestId('brand')).toBeInTheDocument();
  });

  it('keeps the site name for screen readers when a logo image is used, without showing it twice', () => {
    const { container } = render(
      <DocsLayout {...base} config={config}>
        x
      </DocsLayout>,
    );
    const name = container.querySelector('.dk-navbar-brand span')!;
    expect(name).toHaveTextContent('Acme');
    expect(name).toHaveClass('sr-only');
  });
});
