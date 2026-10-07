'use client';

import { Fragment, useEffect, useState } from 'react';
import { formatHotkey, isApple } from '../hooks/hotkeys.ts';
import { KeyCap } from './kbd.tsx';

export interface ShortcutProps {
  /** A chord or sequence in the format `useHotkey` takes: `mod+k`, `?`, `g h`. */
  keys: string;
}

/**
 * Shows a shortcut as keys: `⌘ K` on a Mac, `Ctrl K` elsewhere. The platform is read after the page
 * loads, so the server's markup and the first client render agree.
 */
export function Shortcut({ keys }: ShortcutProps) {
  const [apple, setApple] = useState(false);
  useEffect(() => setApple(isApple()), []);
  const sequence = formatHotkey(keys, apple);
  return (
    <span className="dk-shortcut" data-keys={keys}>
      {sequence.map((chord, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="dk-shortcut-then">then</span>}
          {chord.map((key, j) => (
            <KeyCap key={j}>{key}</KeyCap>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
