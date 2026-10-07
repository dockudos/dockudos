import { Fragment, type ReactNode } from 'react';

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
          <kbd className="inline-block min-w-[1.5em] rounded-md border border-b-2 bg-muted px-1.5 py-0.5 text-center font-mono text-[0.8em] leading-none text-foreground">
            {typeof key === 'string' ? key.trim() : key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
