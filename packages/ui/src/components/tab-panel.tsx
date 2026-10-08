'use client';

import { Tabs as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { useSelectedTab } from './tabs-root.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

/**
 * One panel of `<Tabs>`. Every panel is in the page; the ones not selected are `display: none`, which
 * a printed page overrides to show them all (the `hidden` attribute cannot be overridden: Tailwind's
 * reset marks it `!important`).
 */
export function Tab({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  const selected = useSelectedTab();
  return (
    <Primitive.Content
      forceMount
      style={
        selected !== undefined && selected !== value
          ? { display: 'none' }
          : undefined
      }
      value={value}
      data-label={value}
      className="p-4 text-sm data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>:first-child]:mt-0 [&>:last-child]:mb-0"
    >
      {children}
    </Primitive.Content>
  );
}

Tab.toMarkdown = ((props, children) => {
  const label = md.text(props.value) ?? md.text(props.title) ?? md.text(props.label);
  return md.section(label && md.bold(label), children);
}) satisfies ToMarkdown<{ value?: string; title?: string; label?: string }>;
