import { en, type Messages } from '@dockudos/core';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageSwitcher, VersionSwitcher } from '../layout/variant-controls.tsx';
import { MessagesProvider, useMessages } from '../messages-context.tsx';
import { DocsProvider } from '../provider.tsx';
import { PageActions } from '../layout/page-actions.tsx';
import { Changelog } from './changelog.tsx';
import { normalizeControl, storyCode } from './story.tsx';
import { Update } from './update.tsx';

describe('useMessages', () => {
  it('answers in English without a provider', () => {
    const { result } = renderHook(() => useMessages());
    expect(result.current('language')).toBe(en['language']);
  });

  it('uses the page language, falls back to English for a missing word, and fills in values', () => {
    const partial = { ...en, language: 'Langue' } as Messages;
    delete (partial as Record<string, unknown>)['version'];
    const { result } = renderHook(() => useMessages(), {
      wrapper: ({ children }) => <MessagesProvider messages={partial}>{children}</MessagesProvider>,
    });
    expect(result.current('language')).toBe('Langue');
    expect(result.current('version')).toBe(en['version']);
  });
});

describe('Changelog tag filter', () => {
  const entries = (
    <>
      <Update label="1.2" description="Added" tags={['feature', 'api']}>x</Update>
      <Update label="1.1" description="Fixed" tags={['fix']}>y</Update>
      <Update label="1.0" description="Plain">z</Update>
    </>
  );

  it('offers one button per tag, once each, and no filter when nothing is tagged', () => {
    const { unmount } = render(<Changelog>{entries}</Changelog>);
    const group = screen.getByRole('group', { name: 'Filter by tag' });
    expect([...group.querySelectorAll('button')].map((b) => b.textContent).sort()).toEqual([
      'api',
      'feature',
      'fix',
    ]);
    unmount();
    render(
      <Changelog>
        <Update label="1.0" description="Plain">z</Update>
      </Changelog>,
    );
    expect(screen.queryByRole('group', { name: 'Filter by tag' })).toBeNull();
  });

  it('shows only the entries with the chosen tag, and everything again when it is chosen twice', async () => {
    const { container } = render(<Changelog>{entries}</Changelog>);
    const hidden = () => [...container.querySelectorAll<HTMLElement>('.dk-update')].map((e) => e.hidden);
    expect(hidden()).toEqual([false, false, false]);
    const fix = screen.getByRole('button', { name: 'fix' });
    await userEvent.click(fix);
    expect(fix).toHaveAttribute('aria-pressed', 'true');
    expect(hidden()).toEqual([true, false, true]);
    await userEvent.click(screen.getByRole('button', { name: 'feature' }));
    expect(hidden()).toEqual([false, true, true]);
    await userEvent.click(screen.getByRole('button', { name: 'feature' }));
    expect(hidden()).toEqual([false, false, false]);
    expect(screen.getByRole('button', { name: 'feature' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('normalizeControl', () => {
  it.each([
    ['b', true, { type: 'boolean', value: true, label: 'b' }],
    ['t', 'hi', { type: 'text', value: 'hi', label: 't' }],
    ['n', 3, { type: 'number', value: 3, label: 'n' }],
    ['s', ['a', 'b'], { type: 'select', options: ['a', 'b'], value: 'a', label: 's' }],
    ['e', [], { type: 'select', options: [], value: '', label: 'e' }],
    ['b2', { type: 'boolean' }, { type: 'boolean', value: false, label: 'b2' }],
    ['b3', { type: 'boolean', default: true, label: 'Bold' }, { type: 'boolean', value: true, label: 'Bold' }],
    ['t2', { type: 'text' }, { type: 'text', value: '', label: 't2' }],
    ['t3', { type: 'text', default: 'x', label: 'Text' }, { type: 'text', value: 'x', label: 'Text' }],
    ['n2', { type: 'number' }, { type: 'number', value: 0, label: 'n2' }],
    ['n3', { type: 'number', default: 5, min: 1, max: 9, label: 'Count' }, { type: 'number', value: 5, min: 1, max: 9, default: 5, label: 'Count' }],
    ['s2', { type: 'select', options: ['x', 'y'] }, { type: 'select', options: ['x', 'y'], value: 'x', label: 's2' }],
    ['s3', { type: 'select', options: ['x', 'y'], default: 'y', label: 'Pick' }, { type: 'select', options: ['x', 'y'], value: 'y', label: 'Pick' }],
    ['s4', { type: 'select', options: [] }, { type: 'select', options: [], value: '', label: 's4' }],
  ] as const)('%s', (name, control, expected) => {
    expect(normalizeControl(name, control as never)).toEqual(expected);
  });
});

describe('storyCode', () => {
  it('writes only what differs from the start, in the way a reader would type it', () => {
    expect(storyCode('Badge', { tone: 'warn', size: 2, on: true, off: false, same: 'x' }, { tone: 'info', size: 1, on: false, off: false, same: 'x' })).toBe(
      '<Badge tone="warn" size={2} on />',
    );
    expect(storyCode('Badge', {}, {})).toBe('<Badge />');
    expect(storyCode('Badge', { on: true }, { on: true })).toBe('<Badge on />');
  });
});

describe('PageActions', () => {
  const open = async (props: Partial<Parameters<typeof PageActions>[0]> = {}) => {
    render(<PageActions path="/guides/start" title="Start" {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Start' }));
  };
  const viewAsMarkdown = () => screen.getByRole('menuitem', { name: /View as Markdown/ });

  afterEach(() => {
    delete process.env['NEXT_PUBLIC_DOCKUDOS_BASE_PATH'];
    vi.unstubAllGlobals();
  });

  it('points "view as Markdown" at a .md file next to the page for a static site, under its base path', async () => {
    process.env['NEXT_PUBLIC_DOCKUDOS_BASE_PATH'] = '/docs';
    await open({ markdownEndpoint: 'static' });
    expect(viewAsMarkdown()).toHaveAttribute('href', '/docs/guides/start.md');
    expect(viewAsMarkdown()).toHaveAttribute('rel', 'noreferrer noopener');
    expect(viewAsMarkdown()).toHaveAttribute('target', '_blank');
  });

  it('uses /index.md for the home page of a static site', async () => {
    await open({ path: '/', markdownEndpoint: 'static' });
    expect(viewAsMarkdown()).toHaveAttribute('href', '/index.md');
  });

  it('asks the endpoint with the page path encoded, for a server site', async () => {
    await open({ markdownEndpoint: '/api/markdown', path: '/a b/c' });
    expect(viewAsMarkdown()).toHaveAttribute('href', '/api/markdown?path=%2Fa%20b%2Fc');
  });

  it('offers the AI assistants only when it knows the public address of the page', async () => {
    await open({ markdownEndpoint: 'static' });
    expect(screen.queryByRole('menuitem', { name: /ChatGPT/ })).toBeNull();
  });

  it('hands the public address of the page to an assistant, encoded', async () => {
    await open({ markdownEndpoint: 'static', pageUrl: 'https://docs.example/guides/start' });
    const href = screen.getByRole('menuitem', { name: /ChatGPT/ }).getAttribute('href')!;
    expect(decodeURIComponent(href.split('?q=')[1]!)).toBe(
      'Read https://docs.example/guides/start so I can ask questions about it.',
    );
  });

  it('renders nothing without an endpoint or an edit link, and only the edit link when that is all there is', () => {
    const { container, rerender } = render(<PageActions path="/a" title="A" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PageActions path="/a" title="A" editUrl="https://git.example/a.mdx" />);
    expect(screen.queryByRole('button', { name: 'Copy page' })).toBeNull();
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', 'https://git.example/a.mdx');
  });

  it('copies the page as Markdown and says so', async () => {
    const written: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Start\n', { status: 200 })));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    render(<PageActions path="/guides/start" title="Start" markdownEndpoint="/api/markdown" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(written).toEqual(['# Start\n']);
    expect(fetch).toHaveBeenCalledWith('/api/markdown?path=%2Fguides%2Fstart');
  });

  it('says it failed when the page cannot be fetched, and copies nothing', async () => {
    const written: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    render(<PageActions path="/x" title="X" markdownEndpoint="/api/markdown" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(await screen.findByText(/failed|could not|try again/i)).toBeInTheDocument();
    expect(written).toEqual([]);
  });
});

describe('switchers', () => {
  const locales = [
    { code: 'en', label: 'English', path: '/en/a', exact: true, active: true },
    { code: 'fr', label: 'Français', path: '/fr/a', exact: true, active: false },
  ];

  it('goes to the chosen language and remembers it', async () => {
    const go: string[] = [];
    render(
      <DocsProvider navigate={(h) => go.push(h)}>
        <LanguageSwitcher locales={locales} />
      </DocsProvider>,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'fr');
    expect(go).toEqual(['/fr/a']);
    expect(document.cookie).toContain('dockudos-locale=fr');
  });

  it('shows no choice when there is only one, and an empty value when none is active', async () => {
    const { container, rerender } = render(<LanguageSwitcher locales={[locales[0]!]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<VersionSwitcher versions={[{ name: 'v1', label: 'v1', path: '/v1', exact: true, status: 'stable', active: false }, { name: 'v2', label: 'v2', path: '/v2', exact: true, status: 'stable', active: false }]} />);
    // No version is marked active, so none is selected by the page itself.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('still navigates when the cookie cannot be written', async () => {
    const go: string[] = [];
    const set = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <DocsProvider navigate={(h) => go.push(h)}>
        <LanguageSwitcher locales={locales} />
      </DocsProvider>,
    );
    await act(async () => {
      await userEvent.selectOptions(screen.getByRole('combobox'), 'fr');
    });
    expect(go).toEqual(['/fr/a']);
    set.mockRestore();
  });
});
