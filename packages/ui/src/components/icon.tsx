'use client';

import { type SvgIcon } from '@dockudos/core';
import { ICONS, ICON_NAMES } from '../lib/icons.ts';
import { cn } from '../lib/utils.ts';
import { type IconRegistry, useIconRegistry } from './icons-context.tsx';

export interface IconProps {
  /**
   * A built-in name (`rocket`), one of your own (`acme:logo`), or the address of an image
   * (`/logo.svg`, `https://…/logo.png`).
   */
  name: string;
  /** Size in pixels. Default 16. */
  size?: number;
  className?: string;
  /** Read out by screen readers. Without it the icon is decorative and hidden from them. */
  label?: string;
}

const IMAGE_ADDRESS = /^(?:https?:\/\/|\/(?!\/))[^\s]+$/i;

/** Is a string the address of an image rather than the name of an icon? */
export const isImageAddress = (name: string): boolean =>
  IMAGE_ADDRESS.test(name.trim());

type Found =
  | {
      kind: 'component';
      Component: NonNullable<IconRegistry['components'][string]>;
    }
  | { kind: 'svg'; icon: SvgIcon }
  | { kind: 'builtin'; Component: (typeof ICONS)[string] };

/** Look a name up: your components, then your SVG packs, then the built-in set. */
export function resolveIcon(
  name: string,
  registry: IconRegistry,
): Found | undefined {
  const key = name.trim().toLowerCase();
  const component =
    registry.components[key] ?? registry.components[name.trim()];
  if (component) return { kind: 'component', Component: component };
  const icon = registry.data[key];
  if (icon) return { kind: 'svg', icon };
  const builtin = ICONS[key];
  return builtin ? { kind: 'builtin', Component: builtin } : undefined;
}

/** The built-in icon with this name, if there is one. */
export const findIcon = (name: string) => ICONS[name.trim().toLowerCase()];

/** Edit distance between two short strings. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
}

function unknownIcon(name: string, registry: IconRegistry): Error {
  const key = name.trim().toLowerCase();
  const own = [
    ...Object.keys(registry.data),
    ...Object.keys(registry.components),
  ];
  const colon = key.indexOf(':');
  const prefix = colon > 0 ? key.slice(0, colon) : undefined;
  const packKnown =
    prefix !== undefined && own.some((n) => n.startsWith(`${prefix}:`));
  const pool = packKnown
    ? own.filter((n) => n.startsWith(`${prefix}:`))
    : [...own, ...ICON_NAMES];
  const near = pool
    .map((n) => ({
      n,
      d: Math.min(distance(key, n), n.includes(key.slice(colon + 1)) ? 1 : 99),
    }))
    .filter((x) => x.d <= Math.max(2, Math.floor(key.length / 3)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, 5)
    .map((x) => x.n);
  const hint =
    prefix !== undefined && !packKnown
      ? ` There is no icon pack called "${prefix}".`
      : '';
  return new Error(
    `<Icon name="${name}">: no such icon.${hint}${near.length ? ` Did you mean ${near.join(', ')}?` : ''} See the icon list in the documentation.`,
  );
}

/**
 * An icon by name: `<Icon name="rocket" />`, `<Icon name="acme:logo" />`, or an image address. An unknown
 * name stops the build and suggests the closest ones, so a typo is caught instead of leaving a blank space.
 */
export function Icon({ name, size = 16, className, label }: IconProps) {
  const registry = useIconRegistry();
  const a11y = {
    'aria-hidden': label ? undefined : (true as const),
    'aria-label': label,
    role: label ? 'img' : undefined,
  };
  const classes = cn('inline-block shrink-0 align-[-0.125em]', className);

  if (isImageAddress(name)) {
    // An image keeps its own colors; it cannot follow the text color the way an icon can.
    return (
      <img
        src={name.trim()}
        width={size}
        height={size}
        alt={label ?? ''}
        className={cn(classes, 'object-contain')}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const found = resolveIcon(name, registry);
  if (!found) throw unknownIcon(name, registry);

  if (found.kind === 'svg') {
    return (
      <svg
        viewBox={found.icon.viewBox}
        width={size}
        height={size}
        {...found.icon.attrs}
        className={classes}
        {...a11y}
        // The markup was cleaned of scripts, handlers and outside references when it was read.
        dangerouslySetInnerHTML={{ __html: found.icon.body }}
      />
    );
  }
  const { Component } = found;
  return <Component width={size} height={size} className={classes} {...a11y} />;
}
