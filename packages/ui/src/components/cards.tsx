'use client';

import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { renderIcon } from './render-icon.tsx';
import { SmartLink, isExternal } from './smart-link.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

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
  /** An image shown above the content: its address. */
  img?: string;
  /** Icon beside the text instead of above it. */
  horizontal?: boolean;
  /** Show an arrow on a card with a link. Default: true for external links. */
  arrow?: boolean;
  children?: ReactNode;
}

export function Card({
  title,
  href,
  icon,
  img,
  horizontal,
  arrow,
  children,
}: CardProps) {
  const external = !!href && isExternal(href);
  const showArrow = !!href && (arrow ?? external);
  const text = (
    <div className="min-w-0 flex-1">
      <h3 className="m-0 text-base font-semibold text-foreground">
        {title}
        {showArrow && (
          <ArrowUpRight
            className="ml-1 inline size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </h3>
      {children && (
        <div className="mt-1 text-sm text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0">
          {children}
        </div>
      )}
    </div>
  );
  const iconNode = icon && (
    <div
      className={cn(
        'text-primary [&_svg]:size-5',
        horizontal ? 'mt-0.5 shrink-0' : 'mb-2',
      )}
    >
      {renderIcon(icon, 20)}
    </div>
  );
  const body = (
    <>
      {img && (
        <img
          src={img}
          alt=""
          loading="lazy"
          className="-mx-4 -mt-4 mb-3 w-[calc(100%+2rem)] max-w-none rounded-t-lg"
        />
      )}
      {horizontal ? (
        <div className="flex items-start gap-3">
          {iconNode}
          {text}
        </div>
      ) : (
        <>
          {iconNode}
          {text}
        </>
      )}
    </>
  );
  const className = cn(
    'block overflow-hidden rounded-lg border bg-card p-4 text-card-foreground no-underline',
    href &&
      'transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  );
  if (!href) return <div className={className}>{body}</div>;
  return (
    <SmartLink href={href} className={className}>
      {body}
    </SmartLink>
  );
}

/** The same as `Cards`, under the name other tools use. */
export const CardGroup = Cards;

Cards.toMarkdown = md.container;
Card.toMarkdown = ((props, children) =>
  md.section(md.bold(md.link(md.text(props.title) ?? '', md.text(props.href))), children)) satisfies ToMarkdown<{
  title: string;
  href?: string;
}>;
