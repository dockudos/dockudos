import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatHotkey, matchesChord, parseChord } from './hotkeys.ts';
import { useCopyToClipboard } from './use-copy-to-clipboard.ts';
import { useHotkey, useRegisteredHotkeys } from './use-hotkey.ts';
import { useLocalStorage } from './use-local-storage.ts';
import { useMediaQuery } from './use-media-query.ts';
import { useTheme } from './use-theme.ts';

const key = (init: KeyboardEventInit & { key: string }) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('parseChord and matchesChord', () => {
  it('parses modifiers and aliases', () => {
    expect(parseChord('mod+shift+K')).toMatchObject({
      key: 'k',
      mod: true,
      shift: true,
    });
    expect(parseChord('esc').key).toBe('escape');
    expect(parseChord('ctrl+plus').key).toBe('+');
    expect(parseChord('+').key).toBe('+');
  });

  it('a plain key matches without Ctrl, Cmd or Alt, and ignores Shift for symbols', () => {
    const t = parseChord('t');
    expect(matchesChord(key({ key: 't' }), t, false)).toBe(true);
    expect(matchesChord(key({ key: 't', ctrlKey: true }), t, false)).toBe(
      false,
    );
    expect(matchesChord(key({ key: 't', metaKey: true }), t, false)).toBe(
      false,
    );
    expect(matchesChord(key({ key: 't', altKey: true }), t, false)).toBe(false);
    // Shift+T is a different shortcut from t.
    expect(matchesChord(key({ key: 'T', shiftKey: true }), t, false)).toBe(
      false,
    );
    // `?` needs Shift on most layouts, so Shift is allowed.
    expect(
      matchesChord(key({ key: '?', shiftKey: true }), parseChord('?'), false),
    ).toBe(true);
  });

  it('mod is Ctrl off Apple platforms and Cmd on them', () => {
    const k = parseChord('mod+k');
    expect(matchesChord(key({ key: 'k', ctrlKey: true }), k, false)).toBe(true);
    expect(matchesChord(key({ key: 'k', metaKey: true }), k, false)).toBe(
      false,
    );
    expect(matchesChord(key({ key: 'k', metaKey: true }), k, true)).toBe(true);
    expect(matchesChord(key({ key: 'k', ctrlKey: true }), k, true)).toBe(false);
  });

  it('an explicit shift must be held', () => {
    const c = parseChord('shift+k');
    expect(matchesChord(key({ key: 'K', shiftKey: true }), c, false)).toBe(
      true,
    );
    expect(matchesChord(key({ key: 'k' }), c, false)).toBe(false);
  });
});

describe('formatHotkey', () => {
  it('shows the keys a person would press for the platform', () => {
    expect(formatHotkey('mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatHotkey('mod+k', false)).toEqual([['Ctrl', 'K']]);
    expect(formatHotkey('g h', false)).toEqual([['G'], ['H']]);
    expect(formatHotkey('shift+/', true)).toEqual([['⇧', '/']]);
    expect(formatHotkey('escape')).toEqual([['Esc']]);
  });
});

function Probe({
  keys,
  onKey,
  ...options
}: {
  keys: string | string[];
  onKey: () => void;
  enabled?: boolean;
  description?: string;
  allowInInputs?: boolean;
}) {
  useHotkey(keys, onKey, options);
  return null;
}

describe('useHotkey', () => {
  it('runs the handler for the keys, and stops after unmount', async () => {
    const user = userEvent.setup();
    const onKey = vi.fn();
    const { unmount } = render(<Probe keys="x" onKey={onKey} />);
    await user.keyboard('x');
    expect(onKey).toHaveBeenCalledTimes(1);
    unmount();
    await user.keyboard('x');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('accepts alternatives', async () => {
    const user = userEvent.setup();
    const onKey = vi.fn();
    render(<Probe keys={['a', 'b']} onKey={onKey} />);
    await user.keyboard('ab');
    expect(onKey).toHaveBeenCalledTimes(2);
  });

  it('does nothing while typing in a field, unless allowed', async () => {
    const user = userEvent.setup();
    const plain = vi.fn();
    const allowed = vi.fn();
    render(
      <>
        <Probe keys="q" onKey={plain} />
        <Probe keys="w" onKey={allowed} allowInInputs />
        <input aria-label="field" />
        <textarea aria-label="area" />
        <div contentEditable suppressContentEditableWarning aria-label="rich" />
      </>,
    );
    for (const name of ['field', 'area']) {
      await user.click(screen.getByLabelText(name));
      await user.keyboard('qw');
    }
    expect(plain).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(2);
    await user.click(screen.getByLabelText('rich'));
    await user.keyboard('q');
    expect(plain).not.toHaveBeenCalled();
  });

  it('can be disabled without unmounting', async () => {
    const user = userEvent.setup();
    const onKey = vi.fn();
    const { rerender } = render(
      <Probe keys="y" onKey={onKey} enabled={false} />,
    );
    await user.keyboard('y');
    expect(onKey).not.toHaveBeenCalled();
    rerender(<Probe keys="y" onKey={onKey} enabled />);
    await user.keyboard('y');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('the shortcut registered last wins when two use the same keys', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <Probe keys="z" onKey={first} />
        <Probe keys="z" onKey={second} />
      </>,
    );
    await user.keyboard('z');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('uses the latest handler without re-registering', async () => {
    const user = userEvent.setup();
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(<Probe keys="v" onKey={a} />);
    rerender(<Probe keys="v" onKey={b} />);
    await user.keyboard('v');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('ignores held-down repeats, IME composition and events someone else handled', () => {
    const onKey = vi.fn();
    render(<Probe keys="r" onKey={onKey} />);
    fireEvent.keyDown(document.body, { key: 'r', repeat: true });
    fireEvent.keyDown(document.body, { key: 'r', isComposing: true });
    const handled = key({ key: 'r' });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('supports sequences within a second, and not after a pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onKey = vi.fn();
    render(<Probe keys="g h" onKey={onKey} />);
    await user.keyboard('gh');
    expect(onKey).toHaveBeenCalledTimes(1);
    await user.keyboard('g');
    vi.advanceTimersByTime(1500);
    await user.keyboard('h');
    expect(onKey).toHaveBeenCalledTimes(1);
    await user.keyboard('h');
    expect(onKey).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('prevents the browser default for a shortcut it handles', () => {
    render(<Probe keys="mod+j" onKey={() => undefined} />);
    const e = key({ key: 'j', ctrlKey: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('useRegisteredHotkeys', () => {
  it('lists described shortcuts, and follows mounts and unmounts', () => {
    function List() {
      return (
        <ul>
          {useRegisteredHotkeys().map((e) => (
            <li key={e.id}>{e.description}</li>
          ))}
        </ul>
      );
    }
    const { rerender } = render(
      <>
        <List />
        <Probe
          keys="k1"
          onKey={() => undefined}
          description="Do the first thing"
        />
        <Probe keys="k2" onKey={() => undefined} />
      </>,
    );
    expect(screen.getByText('Do the first thing')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    rerender(<List />);
    expect(screen.queryByText('Do the first thing')).not.toBeInTheDocument();
  });
});

describe('useCopyToClipboard', () => {
  it('copies, reports copied, then returns to idle', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => void (await result.current.copy('hello')));
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.state).toBe('copied');
    act(() => void vi.advanceTimersByTime(1100));
    expect(result.current.state).toBe('idle');
    vi.useRealTimers();
  });

  it('falls back to a hidden textarea, and reports failure when that fails too', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => void (await result.current.copy('x')));
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(result.current.state).toBe('copied');
    expect(document.querySelector('textarea')).toBeNull();

    document.execCommand = vi.fn().mockReturnValue(false);
    await act(async () => void (await result.current.copy('x')));
    expect(result.current.state).toBe('failed');
  });
});

describe('useLocalStorage', () => {
  beforeEach(() => localStorage.clear());

  it('starts with the initial value, then reads and writes storage', async () => {
    localStorage.setItem('k', JSON.stringify('stored'));
    const { result } = renderHook(() => useLocalStorage('k', 'initial'));
    await waitFor(() => expect(result.current[0]).toBe('stored'));
    act(() => result.current[1]('next'));
    expect(JSON.parse(localStorage.getItem('k')!)).toBe('next');
    act(() => result.current[1]((prev) => prev + '!'));
    expect(result.current[0]).toBe('next!');
  });

  it('keeps components using the same key in step', async () => {
    const a = renderHook(() => useLocalStorage('shared', 0));
    const b = renderHook(() => useLocalStorage('shared', 0));
    act(() => a.result.current[1](5));
    await waitFor(() => expect(b.result.current[0]).toBe(5));
  });

  it('survives blocked storage and corrupt JSON', async () => {
    localStorage.setItem('bad', '{nope');
    const { result } = renderHook(() => useLocalStorage('bad', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    act(() => result.current[1]('still works'));
    expect(result.current[0]).toBe('still works');
    vi.restoreAllMocks();
  });
});

describe('useMediaQuery', () => {
  it('follows the query', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const { result } = renderHook(() => useMediaQuery('(min-width: 1px)'));
    expect(result.current).toBe(false);
    matches = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sets, remembers and cycles the mode, and keeps other users of the hook in step', () => {
    const a = renderHook(() => useTheme('light'));
    const b = renderHook(() => useTheme('light'));
    expect(a.result.current.mode).toBe('light');
    act(() => a.result.current.setMode('dark'));
    expect(document.documentElement).toHaveClass('dark');
    expect(a.result.current.resolved).toBe('dark');
    expect(b.result.current.mode).toBe('dark');
    expect(localStorage.getItem('dockudos-theme')).toBe('dark');
    act(() => b.result.current.cycle());
    expect(a.result.current.mode).toBe('system');
    act(() => a.result.current.cycle());
    expect(a.result.current.mode).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
