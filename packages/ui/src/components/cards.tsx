'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { useLink } from '../provider.tsx';
import { renderIcon } from './render-icon.tsx';

export function Cards({
  children,
  columns: columnsProp,
  cols,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  /** The same as `columns`, spelled as in other tools. */
  cols?: 1 | 2 | 3;
}) {
  const columns = columnsProp ?? cols ?? 2;
  return (
    <div
      className={cn(
        'not-prose my-5 grid gap-4',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

export interface CardProps {
  title: string;
  /** Makes the whole card a link. */
  href?: string;
  /** A name from the icon list (`rocket`) or an element. */
  icon?: string | ReactNode;
  children?: ReactNode;
}

export function Card({ title, href, icon, children }: CardProps) {
  const Link = useLink();
  const external = !!href && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
  const body = (
    <>
      {icon && (
        <div className="mb-2 text-primary [&_svg]:size-5">
          {renderIcon(icon, 20)}
        </div>
      )}
      <h3 className="m-0 text-base font-semibold text-foreground">{title}</h3>
      {children && (
        <div className="mt-1 text-sm text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0">
          {children}
        </div>
      )}
    </>
  );
  const className = cn(
    'block rounded-lg border bg-card p-4 text-card-foreground no-underline',
    href &&
      'transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  );
  if (!href) return <div className={className}>{body}</div>;
  return external ? (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noreferrer noopener"
    >
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

/** The same as `Cards`, under the name other tools use. */
export const CardGroup = Cards;
