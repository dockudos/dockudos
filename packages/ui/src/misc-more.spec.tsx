import { render, renderHook } from '@testing-library/react';
import { defineMdxComponents, mdxComponents } from './mdx/components.tsx';
import { useNavigate } from './provider.tsx';
import { ThemeScript } from './theme/theme-script.tsx';
import { readStoredMode } from './theme/theme.ts';

describe('entry points', () => {
  it('navigates with the browser when no host gives another way', () => {
    const { result } = renderHook(() => useNavigate());
    result.current('#somewhere');
    expect(window.location.hash).toBe('#somewhere');
    window.location.hash = '';
  });

  it('writes the theme script, for the system theme unless told otherwise', () => {
    const { container } = render(<ThemeScript />);
    expect(container.querySelector('script')?.innerHTML).toContain('system');
  });

  it('falls back to the default mode when storage is blocked', () => {
    const blocked = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(readStoredMode('dark')).toBe('dark');
    blocked.mockRestore();
  });

  it('defines the component map with or without overrides', () => {
    expect(defineMdxComponents()).toEqual(mdxComponents);
    const Mine = () => null;
    expect(defineMdxComponents({ Callout: Mine }).Callout).toBe(Mine);
  });
});
