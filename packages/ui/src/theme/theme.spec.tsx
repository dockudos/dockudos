import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './theme-toggle.tsx';
import { THEME_STORAGE_KEY, isDark, themeScript } from './theme.ts';

function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(next: boolean) {
      dark = next;
      listeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('isDark', () => {
  it('follows the system only in system mode', () => {
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
  });
});

describe('themeScript (no flash on load)', () => {
  const run = (defaultMode: 'light' | 'dark' | 'system') =>
    new Function(themeScript(defaultMode))();

  it('applies dark from storage before anything renders', () => {
    mockSystem(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run('light');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('uses the configured default, then the system preference, when nothing is stored', () => {
    mockSystem(true);
    run('system');
    expect(document.documentElement).toHaveClass('dark');
    document.documentElement.className = '';
    run('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('ignores a garbage stored value and survives blocked storage', () => {
    mockSystem(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    run('dark');
    expect(document.documentElement).toHaveClass('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => run('light')).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('ThemeToggle', () => {
  it('cycles light, dark, system and persists each choice', async () => {
    mockSystem(false);
    const user = userEvent.setup();
    render(<ThemeToggle defaultMode="light" />);
    const button = () => screen.getByRole('button');

    expect(button()).toHaveAccessibleName('Theme: Light. Switch to Dark');
    await user.click(button());
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await user.click(button());
    expect(button()).toHaveAttribute('data-mode', 'system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    await user.click(button());
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('restores the stored choice on load', () => {
    mockSystem(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle defaultMode="light" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-mode', 'dark');
  });

  it('follows the system setting live in system mode', () => {
    const system = mockSystem(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    render(<ThemeToggle />);
    expect(document.documentElement).not.toHaveClass('dark');
    act(() => system.set(true));
    expect(document.documentElement).toHaveClass('dark');
    act(() => system.set(false));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('keeps working when storage is blocked', async () => {
    mockSystem(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<ThemeToggle defaultMode="light" />);
    await user.click(screen.getByRole('button'));
    expect(document.documentElement).toHaveClass('dark');
    vi.restoreAllMocks();
  });
});
