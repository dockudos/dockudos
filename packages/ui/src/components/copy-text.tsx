'use client';

import { Check, Copy } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard.ts';

export interface CopyTextProps {
  /** What is copied. Defaults to the text content. */
  value?: string;
  children: ReactNode;
}

/** Inline code with a copy button, for a command, a URL or an ID the reader will paste. */
export function CopyText({ value, children }: CopyTextProps) {
  const code = useRef<HTMLElement>(null);
  const { copy, state } = useCopyToClipboard();

  return (
    <span className="dk-copytext">
      <code ref={code}>{children}</code>
      <button
        type="button"
        onClick={() => void copy(value ?? code.current?.textContent ?? '')}
        aria-label="Copy"
        data-print="hide"
      >
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
