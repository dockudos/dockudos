import { Info, Lightbulb, OctagonAlert, StickyNote, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';

export const CALLOUT_TYPES = ['note', 'info', 'tip', 'warning', 'danger'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const ICONS = {
  note: StickyNote,
  info: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
  danger: OctagonAlert,
} as const;

const LABELS: Record<CalloutType, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

export interface CalloutProps {
  type?: CalloutType;
  /** Defaults to the type's name. */
  title?: string;
  children?: ReactNode;
  className?: string;
}

/** A highlighted aside. Written in MDX as `<Callout type="warning">` or `:::warning[Title]`. */
export function Callout({ type = 'note', title, children, className }: CalloutProps) {
  const kind: CalloutType = CALLOUT_TYPES.includes(type) ? type : 'note';
  const Icon = ICONS[kind];
  return (
    <div
      role="note"
      data-callout={kind}
      className={cn(
        'my-5 flex gap-3 rounded-lg border border-l-4 p-4 text-sm leading-relaxed',
        'border-[color-mix(in_oklch,var(--c)_35%,transparent)] border-l-[var(--c)] bg-[color-mix(in_oklch,var(--c)_8%,transparent)]',
        className,
      )}
      style={{ '--c': `var(--dk-callout-${kind})` } as React.CSSProperties}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--c)]" aria-hidden="true" />
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        <p className="m-0 mb-1 font-semibold text-foreground">{title ?? LABELS[kind]}</p>
        <div className="[&>*]:my-0 [&>*+*]:mt-2">{children}</div>
      </div>
    </div>
  );
}
