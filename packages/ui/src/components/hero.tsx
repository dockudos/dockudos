'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { useLink } from '../provider.tsx';

export interface HeroProps {
  /** A small label above the title: a version, "New", a category. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Buttons: `<LinkButton>`s. */
  children?: ReactNode;
}

/** A landing-page banner with a headline, a sentence, and calls to action. Best with `layout: home`. */
export function Hero({ eyebrow, title, description, children }: HeroProps) {
  return (
    <section className="dk-hero">
      {eyebrow && <p className="dk-hero-eyebrow">{eyebrow}</p>}
      <h2 className="dk-hero-title">{title}</h2>
      {description && <p className="dk-hero-description">{description}</p>}
      {children && <div className="dk-hero-actions">{children}</div>}
    </section>
  );
}

export interface LinkButtonProps {
  href: string;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}

/** A link that looks like a button. Internal paths use the router; `https://` links open in a new tab. */
export function LinkButton({
  href,
  variant = 'primary',
  children,
}: LinkButtonProps) {
  const Link = useLink();
  const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
  const className = cn(
    'dk-button',
    variant === 'secondary' && 'dk-button-secondary',
  );
  return external ? (
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
