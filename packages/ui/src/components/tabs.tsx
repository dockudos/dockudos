'use client';

import { Tabs as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';

export interface TabsProps {
  /** Tab labels, in order. Each needs a `<Tab value="...">` with the same text. */
  items: string[];
  /** Initially selected tab; defaults to the first. */
  defaultValue?: string;
  children: ReactNode;
  className?: string;
}

/** Tabbed content. Arrow keys move between tabs, the panel is reachable by Tab. */
export function Tabs({ items, defaultValue = items[0], children, className }: TabsProps) {
  return (
    <Primitive.Root defaultValue={defaultValue} className={cn('my-5 overflow-hidden rounded-lg border', className)}>
      <Primitive.List aria-label="Tabs" className="flex gap-1 overflow-x-auto border-b bg-muted/40 px-2">
        {items.map((item) => (
          <Primitive.Trigger
            key={item}
            value={item}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=active]:border-primary data-[state=active]:text-foreground"
          >
            {item}
          </Primitive.Trigger>
        ))}
      </Primitive.List>
      {children}
    </Primitive.Root>
  );
}

export function Tab({ value, children }: { value: string; children?: ReactNode }) {
  return (
    <Primitive.Content value={value} className="p-4 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      {children}
    </Primitive.Content>
  );
}
