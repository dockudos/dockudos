'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard.ts';
import { cn } from '../lib/utils.ts';
import { renderIcon } from './render-icon.tsx';

export const PROMPT_ACTIONS = ['copy', 'cursor'] as const;
export type PromptAction = (typeof PROMPT_ACTIONS)[number];

export interface PromptProps {
  /** What the prompt is for. One or two sentences. */
  description: string;
  /** Which buttons to show. Default `['copy']`. */
  actions?: PromptAction[];
  /** An icon name or an element, shown beside the description. */
  icon?: string | ReactNode;
  /** The prompt itself. Pass a string (`{`…`}`) to copy it exactly as written. */
  children: ReactNode;
  className?: string;
}

const CURSOR_LINK = 'https://cursor.com/link/prompt?text=';

/**
 * A ready-made prompt for an AI assistant, with buttons to copy it or open it in Cursor. The prompt
 * text is part of the page (in a collapsible block), so it is readable, searchable and printable.
 */
export function Prompt({
  description,
  actions = ['copy'],
  icon,
  children,
  className,
}: PromptProps) {
  const body = useRef<HTMLDivElement>(null);
  const { copy, state } = useCopyToClipboard();
  const text = () =>
    (typeof children === 'string'
      ? children
      : (body.current?.textContent ?? '')
    ).trim();
  const known = actions.filter((a) => PROMPT_ACTIONS.includes(a));

  return (
    <section className={cn('dk-prompt', className)} aria-label="Prompt">
      <div className="dk-prompt-head">
        {icon && <span className="dk-prompt-icon">{renderIcon(icon, 18)}</span>}
        <p className="dk-prompt-description">{description}</p>
        <div className="dk-prompt-actions" data-print="hide">
          {known.includes('copy') && (
            <button
              type="button"
              className="dk-prompt-button"
              onClick={() => void copy(text())}
            >
              {state === 'copied' ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              Copy prompt
            </button>
          )}
          {known.includes('cursor') && (
            <button
              type="button"
              className="dk-prompt-button"
              onClick={() =>
                window.open(
                  `${CURSOR_LINK}${encodeURIComponent(text())}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open in Cursor
              <span className="sr-only"> (opens in a new tab)</span>
            </button>
          )}
        </div>
      </div>
      <details className="dk-prompt-body dk-anim-details">
        <summary>Show prompt</summary>
        <div ref={body}>{children}</div>
      </details>
      <span className="sr-only" role="status">
        {state === 'copied'
          ? 'Copied to clipboard'
          : state === 'failed'
            ? 'Copy failed'
            : ''}
      </span>
    </section>
  );
}
