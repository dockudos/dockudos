import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

export interface ExpandableProps {
  title: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * One collapsible block, for optional detail such as nested properties. It is a native
 * `<details>`: it works without JavaScript and from the keyboard.
 */
export function Expandable({
  title,
  defaultOpen = false,
  children,
}: ExpandableProps) {
  return (
    <details
      open={defaultOpen}
      className="dk-anim-details group my-4 rounded-lg border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          aria-hidden="true"
        />
        {title}
      </summary>
      <div className="border-t px-4 py-3 text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        {children}
      </div>
    </details>
  );
}

Expandable.toMarkdown = ((props, children) => md.section(md.bold(props.title), children)) satisfies ToMarkdown<{
  title: string;
}>;
