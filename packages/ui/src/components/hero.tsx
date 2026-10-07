'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { SmartLink } from './smart-link.tsx';

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
  return (
    <SmartLink
      href={href}
      className={cn(
        'dk-button',
        variant === 'secondary' && 'dk-button-secondary',
      )}
    >
      {children}
    </SmartLink>
  );
}
