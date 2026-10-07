'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copy text and know how it went. `state` returns to `'idle'` after `resetAfter` ms, so a button
 * can show "Copied" briefly. Works without the Clipboard API by falling back to a hidden textarea.
 */
export function useCopyToClipboard(resetAfter = 2000): {
  copy: (text: string) => Promise<boolean>;
  state: CopyState;
} {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = legacyCopy(text);
      }
      setState(ok ? 'copied' : 'failed');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), resetAfter);
      return ok;
    },
    [resetAfter],
  );
  return { copy, state };
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
