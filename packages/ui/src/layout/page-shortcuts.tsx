'use client';

import { useHotkey } from '../hooks/use-hotkey.ts';
import { useNavigate } from '../provider.tsx';

/** Page-level shortcuts: `[` and `]` for the previous and next page, `g h` for the first page. */
export function PageShortcuts({
  prev,
  next,
  home,
}: {
  prev?: { path: string; title: string };
  next?: { path: string; title: string };
  home?: string;
}) {
  const navigate = useNavigate();
  useHotkey('[', () => prev && navigate(prev.path), {
    description: prev ? `Previous page: ${prev.title}` : 'Previous page',
    group: 'Navigation',
    enabled: !!prev,
  });
  useHotkey(']', () => next && navigate(next.path), {
    description: next ? `Next page: ${next.title}` : 'Next page',
    group: 'Navigation',
    enabled: !!next,
  });
  useHotkey('g h', () => home && navigate(home), {
    description: 'Go to the first page',
    group: 'Navigation',
    enabled: !!home,
  });
  return null;
}
