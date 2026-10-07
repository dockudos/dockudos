'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/use-theme.ts';
import { useHotkey } from '../hooks/use-hotkey.ts';
import { type ThemeMode } from './theme.ts';

const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS = { light: 'Light', dark: 'Dark', system: 'System' };
const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

/** Cycles light, dark, system (shortcut: `t`). The choice is stored and the system setting is followed live. */
export function ThemeToggle({
  defaultMode = 'system',
}: {
  defaultMode?: ThemeMode;
}) {
  const { mode, cycle } = useTheme(defaultMode);
  useHotkey('t', cycle, {
    description: 'Switch theme: light, dark, system',
    group: 'Page',
  });

  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ThemeMode;
  const Icon = ICONS[mode];
  return (
    <button
      type="button"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[mode]}. Switch to ${LABELS[next]}`}
      aria-keyshortcuts="t"
      title="Switch theme (T)"
      data-mode={mode}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
