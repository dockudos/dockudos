import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsProvider } from '../provider.tsx';
import {
  CommandPalette,
  PaletteButton,
  type PaletteEntry,
  scoreEntry,
} from './command-palette.tsx';
import { PageActions } from './page-actions.tsx';
import { PageShortcuts } from './page-shortcuts.tsx';
import { ShortcutsDialog, ShortcutsHint } from './shortcuts-dialog.tsx';

const entries: PaletteEntry[] = [
  {
    title: 'Quickstart',
    path: '/quickstart',
    group: 'Get started',
    description: 'Add a page in a minute',
  },
  {
    title: 'Navigation',
    path: '/guides/navigation',
    group: 'Writing',
    description: 'Tabs and groups',
  },
  {
    title: 'Theming',
    path: '/guides/theming',
    group: 'Site',
    description: 'Brand color and dark mode',
  },
  {
    title: 'Tabs',
    path: '/components/tabs',
    group: 'Components',
    description: 'Tabbed content',
  },
];

describe('scoreEntry', () => {
  it('ranks title matches above section and description matches', () => {
    const [quick, nav, theming, tabs] = entries as [
      PaletteEntry,
      PaletteEntry,
      PaletteEntry,
      PaletteEntry,
    ];
    expect(scoreEntry(tabs, 'tabs')).toBeGreaterThan(scoreEntry(nav, 'tabs'));
    expect(scoreEntry(quick, 'start')).toBeGreaterThan(0);
    expect(scoreEntry(theming, 'dark')).toBeGreaterThan(0);
    expect(scoreEntry(theming, 'zzz')).toBe(0);
  });

  it('does not match on the URL, which is the same for a whole section', () => {
    const [, nav] = entries as [PaletteEntry, PaletteEntry];
    expect(scoreEntry(nav, 'guides')).toBe(0);
  });

  it('needs every word, in any order, and matches a title prefix best', () => {
    const [, nav, theming] = entries as [
      PaletteEntry,
      PaletteEntry,
      PaletteEntry,
    ];
    expect(scoreEntry(theming, 'brand dark')).toBeGreaterThan(0);
    expect(scoreEntry(theming, 'brand nothing')).toBe(0);
    expect(scoreEntry(nav, 'nav')).toBeGreaterThan(scoreEntry(nav, 'ation'));
    expect(scoreEntry(nav, '')).toBe(1);
  });
});

function setup(navigate = vi.fn()) {
  render(
    <DocsProvider navigate={navigate}>
      <PaletteButton />
      <CommandPalette entries={entries} />
    </DocsProvider>,
  );
  return navigate;
}

describe('CommandPalette', () => {
  it('opens from Ctrl+K, from "/" and from the button, and closes with Escape', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(
      await screen.findByRole('combobox', { name: 'Search pages' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    await user.keyboard('/');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Search pages' }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('toggles with Ctrl+K even while the search field has focus', async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
  });

  it('filters as you type, with the best match first, and says so when nothing matches', async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard('/');
    await user.type(await screen.findByRole('combobox'), 'tab');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Tabs');
    expect(options.map((o) => o.textContent)).toContainEqual(
      expect.stringContaining('Navigation'),
    );
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No pages match/)).toBeInTheDocument();
  });

  it('moves with the arrow keys and goes to the page with Enter', async () => {
    const user = userEvent.setup();
    const navigate = setup();
    await user.keyboard('/');
    const box = await screen.findByRole('combobox');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(box).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[2]!.id,
    );
    await user.keyboard('{ArrowUp}{Enter}');
    expect(navigate).toHaveBeenCalledWith('/guides/navigation');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
  });

  it('does not go past the ends, and Home and End jump', async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard('/');
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{End}');
    expect(screen.getAllByRole('option')[3]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[3]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('goes to a page when it is clicked, and starts empty the next time', async () => {
    const user = userEvent.setup();
    const navigate = setup();
    await user.keyboard('/');
    await user.type(await screen.findByRole('combobox'), 'them');
    await user.click(screen.getByRole('option', { name: /Theming/ }));
    expect(navigate).toHaveBeenCalledWith('/guides/theming');
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
    await user.keyboard('/');
    expect(await screen.findByRole('combobox')).toHaveValue('');
  });

  it('does not open from "/" while typing in a field', async () => {
    const user = userEvent.setup();
    render(
      <DocsProvider>
        <input aria-label="other" />
        <CommandPalette entries={entries} />
      </DocsProvider>,
    );
    await user.type(screen.getByLabelText('other'), '/');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('ShortcutsDialog', () => {
  it('opens with ? and lists every registered shortcut by group, keys included', async () => {
    const user = userEvent.setup();
    render(
      <DocsProvider navigate={vi.fn()}>
        <PageShortcuts
          prev={{ path: '/a', title: 'Alpha' }}
          next={{ path: '/b', title: 'Beta' }}
          home="/"
        />
        <CommandPalette entries={entries} />
        <ShortcutsDialog />
        <ShortcutsHint />
      </DocsProvider>,
    );
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts',
    });
    const text = dialog.textContent ?? '';
    expect(
      within(dialog).getByRole('heading', { name: 'Navigation' }),
    ).toBeInTheDocument();
    expect(text).toContain('Previous page: Alpha');
    expect(text).toContain('Next page: Beta');
    expect(text).toContain('Search pages');
    expect(text).toContain('Show keyboard shortcuts');
    expect(dialog.querySelector('[data-keys="["]')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // The footer hint opens it too.
    await user.click(
      screen.getByRole('button', { name: /Keyboard shortcuts/ }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('PageShortcuts', () => {
  it('[ and ] go to the previous and next page, and g h to the start', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate}>
        <PageShortcuts
          prev={{ path: '/a', title: 'A' }}
          next={{ path: '/b', title: 'B' }}
          home="/start"
        />
      </DocsProvider>,
    );
    await user.keyboard('[[');
    expect(navigate).toHaveBeenLastCalledWith('/a');
    await user.keyboard(']');
    expect(navigate).toHaveBeenLastCalledWith('/b');
    await user.keyboard('gh');
    expect(navigate).toHaveBeenLastCalledWith('/start');
  });

  it('does nothing for a missing neighbour', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate}>
        <PageShortcuts next={{ path: '/b', title: 'B' }} />
      </DocsProvider>,
    );
    await user.keyboard('[[');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('PageActions', () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockMarkdown(ok = true) {
    const fetch = vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      text: async () => '# Page\n\nBody',
    });
    vi.stubGlobal('fetch', fetch);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return { fetch, writeText };
  }

  it('copies the page as Markdown from the endpoint, and announces it', async () => {
    const user = userEvent.setup();
    const { fetch, writeText } = mockMarkdown();
    render(
      <PageActions
        path="/guides/auth"
        title="Auth"
        markdownEndpoint="/api/markdown"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(fetch).toHaveBeenCalledWith('/api/markdown?path=%2Fguides%2Fauth');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('# Page\n\nBody'),
    );
    expect(
      await screen.findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Page copied as Markdown',
    );
  });

  it('c copies, and e opens the edit link', async () => {
    const user = userEvent.setup();
    const { writeText } = mockMarkdown();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(
      <PageActions
        path="/x"
        title="X"
        markdownEndpoint="/api/markdown"
        editUrl="https://github.com/a/b/edit/main/docs/x.mdx"
      />,
    );
    await user.keyboard('c');
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await user.keyboard('e');
    expect(open).toHaveBeenCalledWith(
      'https://github.com/a/b/edit/main/docs/x.mdx',
      '_blank',
      'noopener',
    );
  });

  it('reports a failed copy', async () => {
    const user = userEvent.setup();
    mockMarkdown(false);
    render(
      <PageActions path="/x" title="X" markdownEndpoint="/api/markdown" />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(
      await screen.findByText('Could not copy the page'),
    ).toBeInTheDocument();
  });

  it('has a menu with view-as-markdown and the assistants when a page URL is known', async () => {
    const user = userEvent.setup();
    mockMarkdown();
    render(
      <PageActions
        path="/x"
        title="Guide"
        markdownEndpoint="/api/markdown"
        pageUrl="https://docs.acme.dev/x"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'More actions for Guide' }),
    );
    expect(
      await screen.findByRole('menuitem', { name: /View as Markdown/ }),
    ).toHaveAttribute('href', '/api/markdown?path=%2Fx');
    const chat = screen.getByRole('menuitem', { name: /Open in ChatGPT/ });
    expect(chat.getAttribute('href')).toContain('https://chatgpt.com/?q=');
    expect(decodeURIComponent(chat.getAttribute('href')!)).toContain(
      'https://docs.acme.dev/x',
    );
    expect(
      screen
        .getByRole('menuitem', { name: /Open in Claude/ })
        .getAttribute('href'),
    ).toContain('https://claude.ai/new?q=');
  });

  it('leaves the assistant items out without a page URL, and renders nothing with no actions', () => {
    mockMarkdown();
    const { container, rerender } = render(
      <PageActions path="/x" title="X" markdownEndpoint="/m" />,
    );
    expect(container.textContent).not.toContain('ChatGPT');
    rerender(<PageActions path="/x" title="X" />);
    expect(container).toBeEmptyDOMElement();
  });
});
