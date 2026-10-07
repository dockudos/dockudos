'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { useLink } from '../provider.tsx';

export function Cards({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
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
  icon?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, href, icon, children }: CardProps) {
  const Link = useLink();
  const external = !!href && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
  const body = (
    <>
      {icon && <div className="mb-2 text-primary [&_svg]:size-5">{icon}</div>}
      <h3 className="m-0 text-base font-semibold text-foreground">{title}</h3>
      {children && <div className="mt-1 text-sm text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>}
    </>
  );
  const className = cn(
    'block rounded-lg border bg-card p-4 text-card-foreground no-underline',
    href && 'transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  );
  if (!href) return <div className={className}>{body}</div>;
  return external ? (
    <a href={href} className={className} target="_blank" rel="noreferrer noopener">
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
