'use client';

import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, live. `false` on the server and until mounted. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** True when the visitor asked their system to reduce motion. */
export const usePrefersReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)');
