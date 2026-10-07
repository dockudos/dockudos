'use client';

import { Tooltip as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';

export interface TooltipProps {
  /** The explanation shown on hover or keyboard focus. */
  tip: string;
  children: ReactNode;
}

/** Inline term with a hover/focus explanation. The term is focusable so keyboard users get the tip too. */
export function Tooltip({ tip, children }: TooltipProps) {
  return (
    <Primitive.Provider delayDuration={150}>
      <Primitive.Root>
        <Primitive.Trigger asChild>
          <span
            tabIndex={0}
            data-tip={tip}
            className="cursor-help underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {children}
          </span>
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0"
          >
            {tip}
            <Primitive.Arrow className="fill-foreground" />
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
