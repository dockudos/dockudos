import type { ReactNode } from 'react';
import { Icon } from './icon.tsx';

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
