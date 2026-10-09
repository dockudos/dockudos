import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { usePrefersReducedMotion } from '../hooks/use-media-query.ts';
import { Icon, findIcon } from './icon.tsx';
import { Kudos } from './kudos.tsx';

describe('Mermaid, leaving early', () => {
  afterEach(() => {
    vi.doUnmock('mermaid');
    vi.resetModules();
  });

  it('draws nothing after it was removed, whether the diagram worked or not', async () => {
    let finish: (v: { svg: string }) => void = () => undefined;
    let fail: (e: Error) => void = () => undefined;
    const render1 = vi.fn(() => new Promise<{ svg: string }>((r) => (finish = r)));
    vi.doMock('mermaid', () => ({ default: { initialize: vi.fn(), render: render1 } }));
    const { Mermaid } = await import('./mermaid.tsx');
    const first = render(<Mermaid chart="graph LR" />);
    await waitFor(() => expect(render1).toHaveBeenCalled());
    first.unmount();
    await act(async () => finish({ svg: '<svg data-testid="late"></svg>' }));
    expect(screen.queryByTestId('late')).toBeNull();

    vi.resetModules();
    const render2 = vi.fn(() => new Promise<{ svg: string }>((_r, rej) => (fail = rej)));
    vi.doMock('mermaid', () => ({ default: { initialize: vi.fn(), render: render2 } }));
    const { Mermaid: Again } = await import('./mermaid.tsx');
    const second = render(<Again chart="graph LR" />);
    await waitFor(() => expect(render2).toHaveBeenCalled());
    second.unmount();
    await act(async () => fail(new Error('late failure')));
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('has no Markdown for a diagram with no source, and fences one that has', async () => {
    const { Mermaid } = await import('./mermaid.tsx');
    const twin = (
      Mermaid as unknown as {
        toMarkdown: (p: object, c: string, ctx: { fence: (s: string) => string }) => string;
      }
    ).toMarkdown;
    const ctx = { fence: (s: string) => s };
    expect(twin({}, '', ctx)).toBe('');
    expect(twin({ chart: ' graph LR ' }, '', ctx)).toBe('```mermaid\ngraph LR\n```');
  });
});

describe('Kudos, remembered votes', () => {
  const ID = '11111111-1111-1111-1111-111111111111';
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('remembers a thumbs down, and ignores storage it cannot read', async () => {
    localStorage.setItem('dockudos-kudos', JSON.stringify({ '/a': { id: ID, vote: 'down' } }));
    const { unmount } = render(<Kudos path="/a" />);
    expect(await screen.findByText('Thanks for your feedback')).toBeInTheDocument();
    unmount();

    localStorage.setItem('dockudos-kudos', '{not json');
    render(<Kudos path="/b" />);
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled();
  });

  it('sends nothing for a blank comment', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: ID }) }));
    vi.stubGlobal('fetch', fetch);
    render(<Kudos path="/c" />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('icons and motion', () => {
  it('finds a built-in icon by name, and not one that does not exist', () => {
    expect(findIcon(' Rocket ')).toBeDefined();
    expect(findIcon('no-such-icon')).toBeUndefined();
  });

  it('has no Markdown of its own', () => {
    expect((Icon as unknown as { toMarkdown: () => string }).toMarkdown()).toBe('');
  });

  it('asks the system about reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });
});
