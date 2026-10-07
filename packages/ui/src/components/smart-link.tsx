'use client';

import type { ReactNode } from 'react';
import { useLink } from '../provider.tsx';

/** Does the address leave this site? A scheme (`https:`, `mailto:`) or a protocol-relative `//`. */
export const isExternal = (href: string): boolean =>
  /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);

export interface SmartLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

/**
 * A link that does the right thing for where it goes: the router for pages of this site, a new tab
 * for other sites (announced to screen readers). Cards, tiles and buttons all use it.
 */
export function SmartLink({ href, className, children }: SmartLinkProps) {
  const Link = useLink();
  return isExternal(href) ? (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
