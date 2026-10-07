'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { SmartLink } from './smart-link.tsx';

export interface TileProps {
  title: string;
  /** One line under the title. */
  description?: string;
  /** Makes the whole tile a link. */
  href?: string;
  /** The preview: an image, a diagram, anything. Shown above the title at a fixed shape. */
  children?: ReactNode;
}

/** A card with a preview on top: for examples, templates and galleries. Put several in `Cards cols={3}`. */
export function Tile({ title, description, href, children }: TileProps) {
  const body = (
    <>
      <div className="dk-tile-preview">{children}</div>
      <div className="dk-tile-text">
        <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </>
  );
  const className = cn('dk-tile', href && 'dk-tile-link');
  if (!href) return <div className={className}>{body}</div>;
  return (
    <SmartLink href={href} className={className}>
      {body}
    </SmartLink>
  );
}
