import type { ReactNode } from 'react';
import { cn } from '../lib/utils.ts';
import { md } from '@dockudos/core';

export interface ColumnsProps {
  /** Columns on wide screens. One column on phones. Default 2. */
  cols?: 2 | 3 | 4;
  children: ReactNode;
}

/** Lay content side by side: `<Columns cols={2}>…</Columns>`. Children are the columns. */
export function Columns({ cols = 2, children }: ColumnsProps) {
  return (
    <div
      className={cn(
        'my-5 grid grid-cols-1 gap-4 [&>*]:min-w-0 [&>:first-child]:mt-0 [&>*]:my-0',
        cols === 2 && 'md:grid-cols-2',
        cols === 3 && 'md:grid-cols-3',
        cols === 4 && 'md:grid-cols-2 lg:grid-cols-4',
      )}
    >
      {children}
    </div>
  );
}

Columns.toMarkdown = md.container;
