'use client';

import { useCallback, useEffect, useState } from 'react';

const EVENT = 'dockudos:storage';

/**
 * State kept in `localStorage` and shared between components using the same key (and between tabs).
 * Storage can be blocked or full; then the value lives in memory for this page view and nothing throws.
 * The first render always uses `initial`, so server and client markup agree.
 * With a `null` key nothing is read or written: the value lives in memory only.
 */
export function useLocalStorage<T>(
  key: string | null,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    if (key === null) return;
    const read = () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) setValue(JSON.parse(raw) as T);
      } catch {
        // unreadable or blocked: keep the current value
      }
    };
    read();
    const onStorage = (e: Event) => {
      if (!(e instanceof StorageEvent) || e.key === key) read();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, onStorage);
    };
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (key !== null) {
          try {
            localStorage.setItem(key, JSON.stringify(resolved));
            queueMicrotask(() => window.dispatchEvent(new CustomEvent(EVENT)));
          } catch {
            // blocked or full: the value still updates for this page view
          }
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
