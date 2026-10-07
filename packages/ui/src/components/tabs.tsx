import { Tabs as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { elementChildren } from '../lib/children.ts';
import { TabsRoot } from './tabs-root.tsx';

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

export function Tab({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  return (
    <Primitive.Content
      value={value}
      className="p-4 text-sm data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>:first-child]:mt-0 [&>:last-child]:mb-0"
    >
      {children}
    </Primitive.Content>
  );
}
