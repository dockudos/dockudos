import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hotkeys } from '../hooks/hotkeys.ts';
import { BookLinks } from './book-links.tsx';
import { paletteEntries } from './palette-entries.ts';
import { Breadcrumb } from './page-nav.tsx';
import { PrintExpander } from './print-expander.tsx';
import { ShortcutsDialog } from './shortcuts-dialog.tsx';
import { tabLinks } from './tab-links.ts';
import { Toc } from './toc.tsx';

describe('PrintExpander', () => {
  it('opens collapsed content for paper and closes it again', () => {
    document.body.innerHTML = `
      <div class="dk-prose">
        <details id="closed"></details>
        <details id="open" open></details>
        <div role="tabpanel" id="hidden" style="display: none"></div>
        <div role="tabpanel" id="visible"></div>
      </div>`;
    const { unmount } = render(<PrintExpander />);
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    expect(($('closed') as HTMLDetailsElement).open).toBe(true);
    expect($('hidden').style.display).toBe('');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(($('closed') as HTMLDetailsElement).open).toBe(false);
    expect(($('open') as HTMLDetailsElement).open).toBe(true);
    expect($('hidden').style.display).toBe('none');
    expect($('visible').style.display).toBe('');
    unmount();
    document.body.innerHTML = '';
  });
});

describe('paletteEntries', () => {
  const page = (path: string, extra = {}) => ({ path, title: path, ...extra });
  it('lists pages once each, skips link tabs, and adds unlisted pages', () => {
    const nav = {
      tabs: [
        {
          title: 'Docs',
          sidebar: [
            { type: 'page', page: page('/a', { sidebarTitle: 'Alpha' }) },
            { type: 'page', page: page('/a') },
            {
              type: 'group',
              title: 'G',
              items: [{ type: 'page', page: page('/b') }],
            },
            { type: 'link', title: 'x', href: '/x' },
          ],
        },
        {
          title: 'Site',
          href: 'https://example.test',
          sidebar: [{ type: 'page', page: page('/skipped') }],
        },
      ],
      unlisted: [page('/b'), page('/c', { description: 'C' })],
    };
    const entries = paletteEntries(nav as never);
    expect(entries.map((e) => [e.title, e.path, e.group])).toEqual([
      ['Alpha', '/a', 'Docs'],
      ['/b', '/b', 'G'],
      ['/c', '/c', undefined],
    ]);
  });
});

describe('Breadcrumb', () => {
  it('shows a crumb without a link as text', () => {
    render(
      <Breadcrumb
        crumbs={[
          { title: 'Home', href: '/' },
          { title: 'Group' },
          { title: 'Page', href: '/p' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Group')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Page')).toHaveAttribute('aria-current', 'page');
  });
});

describe('tabLinks', () => {
  it('leaves out a tab with nowhere to go', () => {
    const tabs = [
      { title: 'Empty' },
      { title: 'Full' },
      { title: 'Ext', href: 'https://x.test' },
    ];
    const links = tabLinks(
      tabs as never,
      (tab) =>
        (tab as { title: string }).title === 'Full' ? '/full' : undefined,
      tabs[1] as never,
    );
    expect(links).toEqual([
      { title: 'Full', href: '/full', external: false, active: true },
      { title: 'Ext', href: 'https://x.test', external: true, active: false },
    ]);
  });
});

describe('ShortcutsDialog', () => {
  it('puts a shortcut with no group under General', async () => {
    const off = hotkeys.register({
      keys: ['f8'],
      handler: () => undefined,
      description: 'No group',
    });
    render(<ShortcutsDialog />);
    await userEvent.keyboard('?');
    expect(await screen.findByText('No group')).toBeInTheDocument();
    off();
  });
});

describe('Toc', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('watches only the headings that exist', () => {
    const observed: string[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = (el: Element) => void observed.push(el.id);
        disconnect = () => undefined;
      },
    );
    document.body.innerHTML = '<h2 id="here"></h2>';
    render(
      <Toc
        entries={[
          { id: 'here', text: 'Here', depth: 2 },
          { id: 'gone', text: 'Gone', depth: 2 },
        ]}
      />,
    );
    expect(observed).toEqual(['here']);
    document.body.innerHTML = '';
  });
});

describe('BookLinks', () => {
  it('leaves a link it cannot read alone', () => {
    document.body.innerHTML = `
      <section data-book-path="/a" id="a"><h2 id="x">X</h2>
        <a id="bad" href="http://[">bad</a>
        <a id="own" href="#x">own</a>
      </section>`;
    const { unmount } = render(<BookLinks />);
    expect(document.getElementById('bad')?.getAttribute('href')).toBe(
      'http://[',
    );
    expect(document.getElementById('own')?.getAttribute('href')).toBe('#a--x');
    unmount();
    document.body.innerHTML = '';
  });
});
