import {
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  isValidElement,
} from 'react';

/** The elements inside `children`, looking through fragments (MDX wraps nested blocks in them) and skipping text. */
export function elementChildren<P = Record<string, unknown>>(
  children: ReactNode,
): ReactElement<P>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return child.type === Fragment
      ? elementChildren<P>(child.props.children)
      : [child as unknown as ReactElement<P>];
  });
}
