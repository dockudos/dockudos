'use client';

import { ChevronDown } from 'lucide-react';
import { Accordion as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { renderIcon } from './render-icon.tsx';

export interface AccordionsProps {
  /** Allow several items open at once. Default: one at a time. */
  multiple?: boolean;
  children: ReactNode;
  className?: string;
}

/** Group of collapsible items. Arrow keys move between headers, Enter and Space toggle. */
export function Accordions({
  multiple = false,
  children,
  className,
}: AccordionsProps) {
  const common = {
    className: cn('my-5 divide-y rounded-lg border', className),
  };
  return multiple ? (
    <Primitive.Root type="multiple" {...common}>
      {children}
    </Primitive.Root>
  ) : (
    <Primitive.Root type="single" collapsible {...common}>
      {children}
    </Primitive.Root>
  );
}

export interface AccordionProps {
  title: string;
  /** Stable id; defaults to the title. */
  value?: string;
  /** Shown before the title: a name from the icon list, or an element. */
  icon?: string | ReactNode;
  children?: ReactNode;
}

export function Accordion({
  title,
  value = title,
  icon,
  children,
}: AccordionProps) {
  return (
    <Primitive.Item value={value}>
      <Primitive.Header className="m-0">
        <Primitive.Trigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span className="flex items-center gap-2">
            {icon && renderIcon(icon, 16, 'text-muted-foreground')}
            {title}
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Primitive.Trigger>
      </Primitive.Header>
      <Primitive.Content
        forceMount
        className="dk-accordion-content overflow-hidden px-4 pb-4 text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      >
        {children}
      </Primitive.Content>
    </Primitive.Item>
  );
}

/** The same as `Accordions`, under the name other tools use. */
export const AccordionGroup = Accordions;
