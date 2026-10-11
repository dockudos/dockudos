import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navbar } from './navbar.tsx';
import { Sidebar } from './sidebar.tsx';

const page = (path: string, extra: object = {}) => ({
  type: 'page' as const,
  page: { path, title: path.slice(1), ...extra },
});

describe('Sidebar', () => {
  it('numbers the steps of a tutorial, shows icons and request methods', () => {
    const items = [
      page('/icon', { icon: 'rocket' }),
      page('/get', { api: { method: 'get' } }),
      page('/custom', { api: { method: 'purge' } }),
      {
        type: 'group' as const,
        title: 'Learn',
        tutorial: true,
        items: [page('/one', { icon: 'rocket' }), page('/two')],
      },
    ];
    const { container } = render(
      <Sidebar items={items as never} path="/one" />,
    );
    expect(container.querySelectorAll('.dk-nav-step')).toHaveLength(2);
    // A numbered step shows its number instead of an icon.
    expect(container.querySelectorAll('.dk-nav-icon')).toHaveLength(1);
    expect(container.querySelector('[data-method="get"]')?.textContent).toBe(
      'GET',
    );
    expect(container.querySelector('[data-method="purge"]')?.textContent).toBe(
      'PURGE',
    );
  });

  it('scrolls its panel to the current page when that is out of view', () => {
    const items = [page('/a'), page('/b')];
    const rect = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
      }) as DOMRect;
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (this.classList.contains('dk-sidebar')) return rect(0, 100);
        if (this.getAttribute('aria-current') === 'page') return rect(500, 20);
        return rect(0, 0);
      });
    const { container, rerender } = render(
      <aside className="dk-sidebar">
        <Sidebar items={items as never} path="/a" />
      </aside>,
    );
    const panel = container.querySelector('.dk-sidebar') as HTMLElement;
    let scrolled = 0;
    Object.defineProperty(panel, 'scrollTop', {
      get: () => scrolled,
      set: (v: number) => void (scrolled = v),
    });
    rerender(
      <aside className="dk-sidebar">
        <Sidebar items={items as never} path="/b" />
      </aside>,
    );
    expect(scrolled).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('Navbar', () => {
  const base = {
    name: 'Acme',
    tabs: [],
    defaultMode: 'system' as const,
    drawer: <a href="/x">In drawer</a>,
  };

  it('shows no section links for a single tab, and links the logo where it says', () => {
    render(<Navbar {...base} logo={{ light: '/l.svg', dark: '/d.svg' }} />);
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    expect(screen.getByRole('link', { name: /Acme/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows a logo given as one address', () => {
    const { container } = render(<Navbar {...base} logo="/logo.svg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo.svg');
  });

  it('stays open when something other than a link is clicked in the drawer, and closes for a link', async () => {
    const user = userEvent.setup();
    render(<Navbar {...base} logo={undefined as never} />);
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(
      await screen.findByText('Acme', { selector: '[role="dialog"] *' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'In drawer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
