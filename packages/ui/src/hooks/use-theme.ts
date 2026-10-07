'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  applyMode,
  isDark,
  readStoredMode,
} from '../theme/theme.ts';

const EVENT = 'dockudos:theme';
const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

export interface UseTheme {
  /** The visitor's choice: light, dark or system. */
  mode: ThemeMode;
  /** What is actually showing: light or dark. `'light'` until mounted. */
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  /** Light, then dark, then system, then light again. */
  cycle: () => void;
}

/**
 * The color theme, for your own components. Every component using it stays in step, the choice is
 * remembered, and `system` follows the operating system live.
 */
export function useTheme(defaultMode: ThemeMode = 'system'): UseTheme {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const sync = () => {
      const next = readStoredMode(defaultMode);
      setModeState(next);
      setResolved(
        isDark(next, matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark'
          : 'light',
      );
    };
    // The page script applied the scheme before React loaded; if the system changed since, catch up.
    applyMode(readStoredMode(defaultMode));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      // Only `system` follows the operating system.
      if (readStoredMode(defaultMode) === 'system') {
        applyMode('system');
        sync();
      }
    };
    query.addEventListener('change', onSystem);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
      query.removeEventListener('change', onSystem);
    };
  }, [defaultMode]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice lasts for this page view only
    }
    applyMode(next);
    setModeState(next);
    setResolved(
      isDark(next, matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light',
    );
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  const cycle = useCallback(
    () => setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ThemeMode),
    [mode, setMode],
  );
  return { mode, resolved, setMode, cycle };
}
