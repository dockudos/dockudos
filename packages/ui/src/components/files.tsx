import {
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** A file tree: `<Files><Folder name="src" defaultOpen><File name="index.ts" /></Folder></Files>`. */
export function Files({ children }: { children: ReactNode }) {
  return (
    <div className="not-prose my-5 rounded-lg border bg-card p-3 text-sm">
      <ul role="tree" aria-label="Files" className="m-0 list-none p-0">
        {children}
      </ul>
    </div>
  );
}

export function File({ name }: { name: string }) {
  return (
    <li
      role="treeitem"
      aria-selected="false"
      className="flex items-center gap-2 py-0.5"
    >
      <FileIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="font-mono text-[0.8125rem]">{name}</span>
    </li>
  );
}

export function Folder({
  name,
  defaultOpen = false,
  children,
}: {
  name: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      role="treeitem"
      aria-expanded={defaultOpen}
      aria-selected="false"
      className="py-0.5"
    >
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <FolderIcon
            className="size-4 shrink-0 text-primary group-open:hidden"
            aria-hidden="true"
          />
          <FolderOpen
            className="hidden size-4 shrink-0 text-primary group-open:block"
            aria-hidden="true"
          />
          <span className="font-mono text-[0.8125rem] font-medium">{name}</span>
        </summary>
        <ul role="group" className="m-0 ml-2 list-none border-l pl-3">
          {children}
        </ul>
      </details>
    </li>
  );
}
