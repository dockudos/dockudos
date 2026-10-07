import type { ComponentType } from 'react';
import type { IconComponent } from '../components/icons-context.tsx';

const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .toLowerCase();

const isComponent = (value: unknown): value is ComponentType =>
  typeof value === 'function' ||
  (typeof value === 'object' && value !== null && '$$typeof' in value);

/**
 * Name a set of React icon components for use with `iconComponents`:
 * `iconPack('tabler', { IconRocket, IconCog })` gives `tabler:icon-rocket` and `tabler:icon-cog`.
 * Pass the exports of an icon library you picked from (import only what you use: every icon you
 * list is sent to the browser). `strip` removes a prefix from each export name first, so
 * `{ strip: 'Icon' }` gives `tabler:rocket`.
 */
export function iconPack(
  prefix: string,
  components: Record<string, unknown>,
  { strip = '' }: { strip?: string } = {},
): Record<string, IconComponent> {
  const out: Record<string, IconComponent> = {};
  for (const [exportName, value] of Object.entries(components)) {
    if (!/^[A-Z]/.test(exportName) || !isComponent(value)) continue;
    const base =
      strip && exportName.startsWith(strip)
        ? exportName.slice(strip.length)
        : exportName;
    if (base) out[`${prefix}:${kebab(base)}`] = value as IconComponent;
  }
  return out;
}
