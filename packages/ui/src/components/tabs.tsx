import type { ReactNode } from 'react';
import { elementChildren } from '../lib/children.ts';
import { TabsRoot } from './tabs-root.tsx';
export { Tab } from './tab-panel.tsx';

export interface TabsProps {
  /** Tab labels in order. Optional: taken from the `value` of each `<Tab>` when omitted. */
  items?: string[];
  /** Initially selected tab; defaults to the first. */
  defaultValue?: string;
  /** Tabs with the same `groupId` switch together and remember the choice. */
  groupId?: string;
  children: ReactNode;
  className?: string;
}

const valuesOf = (children: ReactNode): string[] =>
  elementChildren<{ value?: unknown }>(children).flatMap((child) =>
    typeof child.props.value === 'string' ? [child.props.value] : [],
  );

/** Tabbed content. Arrow keys move between tabs; the panel is reachable by Tab. */
export function Tabs({ items, children, ...rest }: TabsProps) {
  return (
    <TabsRoot items={items ?? valuesOf(children)} {...rest}>
      {children}
    </TabsRoot>
  );
}
