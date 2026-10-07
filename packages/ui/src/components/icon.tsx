import type { ReactNode } from 'react';
import { ICONS, ICON_NAMES } from '../lib/icons.ts';
import { cn } from '../lib/utils.ts';

export interface IconProps {
  /** A name from the icon list, such as `rocket`, `book-open`, `shield-check`. */
  name: string;
  /** Size in pixels. Default 16. */
  size?: number;
  className?: string;
  /** Read out by screen readers. Without it the icon is decorative and hidden from them. */
  label?: string;
}

/** The named icon, or `undefined` when there is none (for callers that fall back to something else). */
export function findIcon(name: string) {
  return ICONS[name.trim().toLowerCase()];
}

/**
 * An icon by name: `<Icon name="rocket" />`. An unknown name stops the build and suggests the closest
 * ones, so a typo is caught instead of leaving a blank space.
 */
export function Icon({ name, size = 16, className, label }: IconProps) {
  const Component = findIcon(name);
  if (!Component) {
    const near = ICON_NAMES.filter((n) =>
      n.includes(name.toLowerCase().slice(0, 3)),
    ).slice(0, 5);
    throw new Error(
      `<Icon name="${name}">: no such icon.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} See the icon list in the documentation.`,
    );
  }
  return (
    <Component
      width={size}
      height={size}
      className={cn('inline-block shrink-0 align-[-0.125em]', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

/** An `icon` prop that is a name, an element, or nothing, as something renderable. */
export function renderIcon(
  icon: string | ReactNode,
  size = 16,
  className?: string,
): ReactNode {
  if (typeof icon === 'string')
    return icon ? <Icon name={icon} size={size} className={className} /> : null;
  return icon ?? null;
}
