import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { DocsProvider } from '../provider.tsx';
import { formatHotkey, hotkeys } from './hotkeys.ts';
import { useRegisteredHotkeys } from './use-hotkey.ts';
import { useLocalStorage } from './use-local-storage.ts';
import { useMediaQuery } from './use-media-query.ts';
import { useSearchClient } from './use-search.ts';
import { useTheme } from './use-theme.ts';

describe('hotkeys', () => {
  it('shows ctrl, meta and alt in a chord', () => {
    expect(formatHotkey('ctrl+meta+alt+x', false)).toEqual([
      ['Ctrl', 'Win', 'Alt', 'X'],
    ]);
    expect(formatHotkey('ctrl+meta+alt+x', true)[0]).toHaveLength(4);
  });

  it('replaces an entry’s handler without registering again', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = hotkeys.register({
      keys: ['f9'],
      handler: first,
      description: 'Test',
    });
    const entry = hotkeys.list().find((e) => e.handler === first);
    hotkeys.update((entry as { id: number }).id, { handler: second });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    off();
  });

  it('lists no shortcuts on the server', () => {
    const Probe = () => <p>{useRegisteredHotkeys().length}</p>;
    expect(renderToString(<Probe />)).toContain('0');
  });
});

describe('useMediaQuery on the server', () => {
  it('is false', () => {
    const Probe = () => <p>{String(useMediaQuery('(min-width: 1px)'))}</p>;
    expect(renderToString(<Probe />)).toContain('false');
  });
});

describe('useLocalStorage', () => {
  it('ignores a storage event for another key and an event that is not a storage event', () => {
    localStorage.setItem('mine', JSON.stringify('one'));
    const { result } = renderHook(() => useLocalStorage('mine', 'start'));
    expect(result.current[0]).toBe('one');
    localStorage.setItem('mine', JSON.stringify('two'));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    });
    expect(result.current[0]).toBe('one');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'mine' }));
    });
    expect(result.current[0]).toBe('two');
    localStorage.setItem('mine', JSON.stringify('three'));
    act(() => {
      window.dispatchEvent(new Event('storage'));
    });
    expect(result.current[0]).toBe('three');
  });
});

describe('useTheme', () => {
  it('only follows the system while the mode is system', () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    try {
      localStorage.setItem('dockudos-theme', 'light');
      const { result } = renderHook(() => useTheme('system'));
      act(() => listeners.forEach((fn) => fn()));
      expect(result.current.mode).toBe('light');
      localStorage.setItem('dockudos-theme', 'system');
      act(() => listeners.forEach((fn) => fn()));
      expect(result.current.resolved).toBe('light');
    } finally {
      vi.unstubAllGlobals();
      localStorage.clear();
    }
  });
});

describe('useSearchClient', () => {
  it('has no client without settings or a provided backend', () => {
    const { result } = renderHook(() => useSearchClient(undefined));
    expect(result.current).toBeUndefined();
  });

  it('builds a client for the built-in index, a named endpoint backend, or a provided one', () => {
    const builtin = renderHook(() => useSearchClient({}));
    expect(builtin.result.current).toBeDefined();
    const named = renderHook(() =>
      useSearchClient({ backend: 'algolia' as never, endpoint: '/s' }),
    );
    expect(named.result.current).toBeDefined();
    const backend = { id: 'mine', search: async () => [] };
    const provided = renderHook(() => useSearchClient(undefined), {
      wrapper: ({ children }) => (
        <DocsProvider searchBackend={backend as never}>{children}</DocsProvider>
      ),
    });
    expect(provided.result.current).toBeDefined();
  });
});
