'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  applyMode,
  readStoredMode,
} from './theme.ts';

const ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS = { light: 'Light', dark: 'Dark', system: 'System' };

/** Cycles light, dark, system. The choice is stored and the system setting is followed live. */
export function ThemeToggle({
  defaultMode = 'system',
}: {
  defaultMode?: ThemeMode;
}) {
  const [mode, setMode] = useState<ThemeMode>(defaultMode);

  // Read the stored choice after mount so server and first client render agree.
  useEffect(() => setMode(readStoredMode(defaultMode)), [defaultMode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyMode('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  const choose = (next: ThemeMode) => {
    setMode(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice lasts for this page view only
    }
    applyMode(next);
  };

  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ThemeMode;
  const Icon = ICONS[mode];
  return (
    <button
      type="button"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => choose(next)}
      aria-label={`Theme: ${LABELS[mode]}. Switch to ${LABELS[next]}`}
      data-mode={mode}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
