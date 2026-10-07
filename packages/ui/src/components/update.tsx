import type { ReactNode } from 'react';
import { Badge } from './badge.tsx';

export interface UpdateProps {
  /** The version or title: `1.4.0`, `March release`. */
  label: string;
  /** `YYYY-MM-DD`. Shown formatted, and machine readable. */
  date?: string;
  /** Short categories such as `Added`, `Fixed`, `Breaking`. */
  tags?: string[];
  children?: ReactNode;
}

const format = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

/** One entry of a changelog or release notes. Stack several; newest first. */
export function Update({ label, date, tags, children }: UpdateProps) {
  const parsed =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00Z`)
      : undefined;
  return (
    <article className="dk-update">
      <header className="dk-update-meta">
        <h3 className="dk-update-label">{label}</h3>
        {date &&
          (parsed ? (
            <time dateTime={date}>{format.format(parsed)}</time>
          ) : (
            <span>{date}</span>
          ))}
        {tags && tags.length > 0 && (
          <div className="dk-update-tags">
            {tags.map((tag) => (
              <Badge
                key={tag}
                color={tag.toLowerCase() === 'breaking' ? 'red' : 'blue'}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </header>
      <div className="dk-update-body">{children}</div>
    </article>
  );
}
