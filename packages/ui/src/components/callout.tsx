import {
  CircleCheck,
  Info as InfoIcon,
  Lightbulb,
  OctagonAlert,
  StickyNote,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { renderIcon } from './render-icon.tsx';

export const CALLOUT_TYPES = [
  'note',
  'info',
  'tip',
  'check',
  'warning',
  'danger',
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const ICONS = {
  note: StickyNote,
  info: InfoIcon,
  tip: Lightbulb,
  check: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
} as const;

const LABELS: Record<CalloutType, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  check: 'Check',
  warning: 'Warning',
  danger: 'Danger',
};

export interface CalloutProps {
  type?: CalloutType;
  /** Defaults to the type's name. */
  title?: string;
  /** Replaces the icon: a name from the icon list (`rocket`) or an element. */
  icon?: string | ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A highlighted aside. Written in MDX as `<Callout type="warning">` or `:::warning[Title]`. */
export function Callout({
  type = 'note',
  title,
  icon,
  children,
  className,
}: CalloutProps) {
  const kind: CalloutType = CALLOUT_TYPES.includes(type) ? type : 'note';
  const Icon = ICONS[kind];
  const custom = icon
    ? renderIcon(icon, 16, 'mt-0.5 size-4 shrink-0 text-[var(--c)]')
    : null;
  return (
    <div
      role="note"
      data-callout={kind}
      className={cn(
        'my-5 flex gap-3 rounded-lg border border-l-4 p-4 text-sm leading-relaxed animate-in fade-in-0 duration-300',
        'border-[color-mix(in_oklch,var(--c)_35%,transparent)] border-l-[var(--c)] bg-[color-mix(in_oklch,var(--c)_8%,transparent)]',
        className,
      )}
      style={{ '--c': `var(--dk-callout-${kind})` } as React.CSSProperties}
    >
      {custom ?? (
        <Icon
          className="mt-0.5 size-4 shrink-0 text-[var(--c)]"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        <p className="m-0 mb-1 font-semibold text-foreground">
          {title ?? LABELS[kind]}
        </p>
        <div className="[&>*]:my-0 [&>*+*]:mt-2">{children}</div>
      </div>
    </div>
  );
}

type Shorthand = Omit<CalloutProps, 'type'>;

/** Shorthands for `<Callout type="…">`, so pages written for other tools work as they are. */
export const Note = (props: Shorthand) => <Callout type="note" {...props} />;
export const Info = (props: Shorthand) => <Callout type="info" {...props} />;
export const Tip = (props: Shorthand) => <Callout type="tip" {...props} />;
export const Check = (props: Shorthand) => <Callout type="check" {...props} />;
export const Warning = (props: Shorthand) => (
  <Callout type="warning" {...props} />
);
export const Danger = (props: Shorthand) => (
  <Callout type="danger" {...props} />
);
