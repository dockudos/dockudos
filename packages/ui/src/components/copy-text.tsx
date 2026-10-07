'use client';

import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface CopyTextProps {
  /** What is copied. Defaults to the text content. */
  value?: string;
  children: ReactNode;
}

/** Inline code with a copy button, for a command, a URL or an ID the reader will paste. */
export function CopyText({ value, children }: CopyTextProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const code = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        value ?? code.current?.textContent ?? '',
      );
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <span className="dk-copytext">
      <code ref={code}>{children}</code>
      <button type="button" onClick={copy} aria-label="Copy" data-print="hide">
        {state === 'copied' ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied'
          ? 'Copied to clipboard'
          : state === 'failed'
            ? 'Copy failed'
            : ''}
      </span>
    </span>
  );
}
