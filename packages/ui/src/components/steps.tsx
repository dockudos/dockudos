import type { ReactNode } from 'react';
import { renderIcon } from './render-icon.tsx';

/** A numbered procedure: `<Steps><Step title="Install">…</Step></Steps>`. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="dk-steps">{children}</ol>;
}

export function Step({
  title,
  icon,
  children,
}: {
  title?: string;
  /** Shown in place of the number: a name from the icon list, or an element. */
  icon?: string | ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="dk-step" data-has-icon={icon ? '' : undefined}>
      {icon && <span className="dk-step-icon">{renderIcon(icon, 14)}</span>}
      {title && <h3 className="dk-step-title">{title}</h3>}
      <div className="dk-step-body">{children}</div>
    </li>
  );
}
