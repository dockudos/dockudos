import { Fragment, type ReactNode } from 'react';

/** One keycap. The single look for keys, shared by `Kbd` and `Shortcut`. */
export function KeyCap({ children }: { children: ReactNode }) {
  return <kbd className="dk-key">{children}</kbd>;
}

export interface KbdProps {
  /** One key as text, or several keys joined with `+` like `Ctrl+K`. */
  children: ReactNode;
}

/** A keyboard key. `<Kbd>Ctrl+K</Kbd>` shows two keys joined by a plus. */
export function Kbd({ children }: KbdProps) {
  const keys = typeof children === 'string' ? children.split('+') : [children];
  return (
    <span className="whitespace-nowrap">
      {keys.map((key, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> + </span>}
          <KeyCap>{typeof key === 'string' ? key.trim() : key}</KeyCap>
        </Fragment>
      ))}
    </span>
  );
}
