import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { md, type ToMarkdown } from '@dockudos/core';

export const BADGE_COLORS = ['gray', 'blue', 'green', 'amber', 'red'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

const VARS: Record<BadgeColor, string> = {
  gray: 'var(--dk-callout-note)',
  blue: 'var(--dk-callout-info)',
  green: 'var(--dk-callout-tip)',
  amber: 'var(--dk-callout-warning)',
  red: 'var(--dk-callout-danger)',
};

export interface BadgeProps {
  color?: BadgeColor;
  children: ReactNode;
}

/** A small inline label, such as `New`, `Beta` or `Deprecated`. */
export function Badge({ color = 'gray', children }: BadgeProps) {
  const known = BADGE_COLORS.includes(color) ? color : 'gray';
  return (
    <span
      data-badge={known}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 align-middle text-xs leading-none font-medium whitespace-nowrap',
        'border-[color-mix(in_oklch,var(--c)_40%,transparent)] bg-[color-mix(in_oklch,var(--c)_12%,transparent)] text-foreground',
      )}
      style={{ '--c': VARS[known] } as React.CSSProperties}
    >
      {children}
    </span>
  );
}

Badge.toMarkdown = ((_props, children) => md.bold(children.trim())) satisfies ToMarkdown;
