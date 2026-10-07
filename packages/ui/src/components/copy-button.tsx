'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** The text of a rendered code block: no diff-removed lines, no Twoslash popups. */
export function codeText(pre: Element): string {
  const clone = pre.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      '.diff.remove, [class*="twoslash-popup"], .twoslash-completion-list',
    )
    .forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\n+$/, '');
}

/** Copies the code block it sits in. Announces the result to screen readers. */
export function CopyButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const pre = ref.current?.closest('.dk-code')?.querySelector('pre');
    if (!pre) return;
    try {
      await navigator.clipboard.writeText(codeText(pre));
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={copy}
        className="dk-copy inline-flex size-8 items-center justify-center rounded-md border bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Copy code"
        data-print="hide"
      >
        {state === 'copied' ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied'
          ? 'Copied to clipboard'
          : state === 'failed'
            ? 'Copy failed'
            : ''}
      </span>
    </>
  );
}
