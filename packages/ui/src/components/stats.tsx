import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { md, type ToMarkdown } from '@dockudos/core';

export interface StatsProps {
  /** Columns on wide screens. Default 3. */
  cols?: 2 | 3 | 4;
  children: ReactNode;
}

/** A row of key numbers: `<Stats><Stat label="Uptime" value="99.99%" /></Stats>`. */
export function Stats({ cols = 3, children }: StatsProps) {
  return (
    <dl
      className={cn(
        'dk-stats not-prose my-5 grid grid-cols-1 gap-4',
        cols === 2 && 'sm:grid-cols-2',
        cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        cols === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
      )}
    >
      {children}
    </dl>
  );
}

export interface StatProps {
  /** What is measured. */
  label: string;
  /** The number, written the way it should be read: `99.99%`, `2.3 s`. */
  value: string;
  /** A line of context under the value. */
  description?: string;
}

export function Stat({ label, value, description }: StatProps) {
  return (
    <div className="dk-stat">
      <dt>{label}</dt>
      <dd className="dk-stat-value">{value}</dd>
      {description && <dd className="dk-stat-description">{description}</dd>}
    </div>
  );
}

Stats.toMarkdown = md.container;
Stat.toMarkdown = ((props) =>
  md.item(`${md.bold(`${props.label}:`)} ${props.value}${props.description ? ` (${props.description})` : ''}`)) satisfies ToMarkdown<{
  label: string;
  value: string;
  description?: string;
}>;
