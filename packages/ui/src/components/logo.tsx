import type { SVGProps } from 'react';
import { cn } from '../lib/utils.ts';

/**
 * The dockudos mark: a page with a folded corner (doc) and a check badge (kudos).
 * The page uses the current text color; the badge uses the brand color.
 */
export function LogoMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-6', className)}
      {...props}
    >
      <path
        d="M8 3h10l7 7v10.5M8 3a3 3 0 0 0-3 3v20a3 3 0 0 0 3 3h8M18 3v5a2 2 0 0 0 2 2h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="23" r="7" style={{ fill: 'var(--primary)' }} />
      <path
        d="m19.8 23.2 2.1 2.1 4.1-4.4"
        stroke="var(--primary-foreground)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "doc" in the text color and "kudos" in the brand color. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-semibold tracking-tight', className)}>
      <span>doc</span>
      <span style={{ color: 'var(--primary)' }}>kudos</span>
    </span>
  );
}

/** The dockudos logo: mark and two-color wordmark. Reads as "dockudos" to screen readers. */
export function Logo({
  className,
  showMark = true,
}: {
  className?: string;
  showMark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {showMark && <LogoMark />}
      <Wordmark className="text-lg" />
      <span className="sr-only">dockudos</span>
    </span>
  );
}
