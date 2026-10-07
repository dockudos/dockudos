'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type HotkeyEntry, hotkeys } from './hotkeys.ts';

export interface UseHotkeyOptions {
  /** Listed in the shortcuts dialog (press `?`). Leave it out to keep the shortcut unlisted. */
  description?: string;
  /** Heading in the dialog. Default "General". */
  group?: string;
  /** Turn the shortcut off without unmounting. Default true. */
  enabled?: boolean;
  /** Fire while typing in a field. Default false. */
  allowInInputs?: boolean;
}

/**
 * Run `handler` when the keys are pressed. `keys` is one chord (`'t'`, `'?'`, `'mod+k'`,
 * `'shift+/'`), a sequence (`'g h'`), or a list of alternatives (`['mod+k', '/']`).
 * It is ignored while the person types in a field, and removed when the component unmounts.
 * If two shortcuts use the same keys, the one registered last wins.
 */
export function useHotkey(
  keys: string | string[],
  handler: (event: KeyboardEvent) => void,
  {
    description,
    group = 'General',
    enabled = true,
    allowInInputs = false,
  }: UseHotkeyOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const list = Array.isArray(keys) ? keys : [keys];
  const signature = list.join('|');

  useEffect(() => {
    if (!enabled) return;
    return hotkeys.register({
      keys: signature.split('|'),
      handler: (e) => handlerRef.current(e),
      description,
      group,
      allowInInputs,
    });
  }, [signature, enabled, description, group, allowInInputs]);
}

/** Every registered shortcut that has a description. Re-renders when shortcuts come and go. */
export function useRegisteredHotkeys(): readonly HotkeyEntry[] {
  return useSyncExternalStore(hotkeys.subscribe, hotkeys.list, () => []);
}
