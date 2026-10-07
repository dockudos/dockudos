'use client';

import { X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/utils.ts';

export interface BannerProps {
  children: ReactNode;
  /** Makes the banner dismissible and remembers the choice under this key. */
  id?: string;
  variant?: 'default' | 'rainbow';
}

const key = (id: string) => `dockudos-banner-${id}`;

/** A site-wide announcement strip. With an `id` it can be dismissed and stays dismissed. */
export function Banner({ children, id, variant = 'default' }: BannerProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!id) return;
    try {
      setHidden(localStorage.getItem(key(id)) === '1');
    } catch {
      // storage unavailable: show the banner
    }
  }, [id]);

  if (hidden) return null;
  return (
    <div
      role="region"
      aria-label="Announcement"
      className={cn(
        'relative flex items-center justify-center gap-2 px-10 py-2 text-center text-sm font-medium',
        variant === 'rainbow'
          ? 'bg-gradient-to-r from-primary/30 via-accent to-primary/30 text-foreground'
          : 'bg-primary text-primary-foreground',
      )}
    >
      <div>{children}</div>
      {id && (
        <button
          type="button"
          aria-label="Dismiss announcement"
          data-print="hide"
          className="absolute right-2 inline-flex size-7 items-center justify-center rounded-md hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(key(id), '1');
            } catch {
              // dismissal lasts for this page view only
            }
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
