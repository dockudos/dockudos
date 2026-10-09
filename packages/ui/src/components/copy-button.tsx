'use client';

import { Check, Copy } from 'lucide-react';
import { useRef } from 'react';
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard.ts';

/** The text of a rendered code block: no diff-removed lines, no Twoslash popups. */
export function codeText(pre: Element): string {
  const clone = pre.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      '.diff.remove, [class*="twoslash-popup"], .twoslash-completion-list',
    )
    .forEach((n) => n.remove());
  return clone.textContent.replace(/\n+$/, '');
}

/** Copies the code block it sits in, or `text` when the code is not in a `<pre>`. Announces the result to screen readers. */
export function CopyButton({ text }: { text?: string } = {}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copy, state } = useCopyToClipboard();

  const onClick = () => {
    if (text !== undefined) return void copy(text);
    const pre = ref.current?.closest('.dk-code')?.querySelector('pre');
    if (pre) void copy(codeText(pre));
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
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
