import type { ReactNode } from 'react';
import { Badge, type BadgeColor } from './badge.tsx';

/** A dated sequence of events, such as a roadmap or a history. */
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="dk-timeline">{children}</ol>;
}

const STATUS: Record<
  'done' | 'current' | 'planned',
  { label: string; color: BadgeColor }
> = {
  done: { label: 'Done', color: 'green' },
  current: { label: 'In progress', color: 'blue' },
  planned: { label: 'Planned', color: 'gray' },
};

export interface TimelineItemProps {
  title: string;
  /** When: `2026-03`, `Q3 2026`, `Next`. Shown as written. */
  date?: string;
  /** Where it stands. Shown as a label, so it is never only a color. */
  status?: keyof typeof STATUS;
  children?: ReactNode;
}

export function TimelineItem({
  title,
  date,
  status,
  children,
}: TimelineItemProps) {
  const known = status && STATUS[status];
  return (
    <li className="dk-timeline-item" data-status={status}>
      <div className="dk-timeline-head">
        {date && <span className="dk-timeline-date">{date}</span>}
        <h3 className="dk-timeline-title">{title}</h3>
        {known && <Badge color={known.color}>{known.label}</Badge>}
      </div>
      {children && <div className="dk-timeline-body">{children}</div>}
    </li>
  );
}
