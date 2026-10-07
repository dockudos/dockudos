'use client';

import { Tabs as Primitive } from 'radix-ui';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { cn } from '../lib/utils.ts';

const EVENT = 'dockudos:tabs';

/** The selected tab's value, so panels can hide themselves while staying in the page for printing. */
const SelectedTab = createContext<string | undefined>(undefined);
export const useSelectedTab = () => useContext(SelectedTab);
const storageKey = (groupId: string) => `dockudos-tabs-${groupId}`;

export interface TabsRootProps {
  items: string[];
  defaultValue?: string;
  /** Tabs sharing a `groupId` stay in step on the page and remember the choice. */
  groupId?: string;
  children: ReactNode;
  className?: string;
}

export function TabsRoot({
  items,
  defaultValue = items[0],
  groupId,
  children,
  className,
}: TabsRootProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (!groupId) return;
    try {
      const stored = localStorage.getItem(storageKey(groupId));
      if (stored && items.includes(stored)) setValue(stored);
    } catch {
      // storage unavailable: keep the default
    }
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<{ groupId: string; value: string }>)
        .detail;
      if (detail.groupId === groupId && items.includes(detail.value))
        setValue(detail.value);
    };
    window.addEventListener(EVENT, onSync);
    return () => window.removeEventListener(EVENT, onSync);
  }, [groupId, items]);

  const change = (next: string) => {
    setValue(next);
    if (!groupId) return;
    try {
      localStorage.setItem(storageKey(groupId), next);
    } catch {
      // the choice lasts for this page view only
    }
    window.dispatchEvent(
      new CustomEvent(EVENT, { detail: { groupId, value: next } }),
    );
  };

  return (
    <Primitive.Root
      value={value}
      onValueChange={change}
      className={cn(
        'dk-tabs my-5 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <Primitive.List
        aria-label="Tabs"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b bg-muted/40 px-2"
      >
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
      <SelectedTab.Provider value={value}>{children}</SelectedTab.Provider>
    </Primitive.Root>
  );
}
