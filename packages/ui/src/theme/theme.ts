export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'dockudos-theme';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Whether a mode shows the dark scheme, given the system preference. */
export function isDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

export function readStoredMode(fallback: ThemeMode): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function applyMode(mode: ThemeMode): void {
  const dark = isDark(mode, matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** Inline script run before first paint so the page never flashes the wrong scheme. */
export function themeScript(defaultMode: ThemeMode): string {
  return `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var m=s==='light'||s==='dark'||s==='system'?s:${JSON.stringify(defaultMode)};var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}})()`;
}
