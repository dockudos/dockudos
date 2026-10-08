import {
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

/** A file tree: `<Tree><Tree.Folder name="src" defaultOpen><Tree.File name="index.ts" /></Tree.Folder></Tree>`. */
function TreeRoot({ children }: { children: ReactNode }) {
  return (
    <div className="not-prose my-5 rounded-lg border bg-card p-3 text-sm">
      <ul role="tree" aria-label="File tree" className="m-0 list-none p-0">
        {children}
      </ul>
    </div>
  );
}

const customIcon = (icon: ReactNode) => (
  <span
    aria-hidden="true"
    className="inline-flex shrink-0 items-center [&_img]:size-4 [&_svg]:size-4"
  >
    {icon}
  </span>
);

export interface TreeFileProps {
  name: string;
  /** Replaces the default file icon. Any element: an SVG, an `<img>`, an icon component. */
  icon?: ReactNode;
}

export function TreeFile({ name, icon }: TreeFileProps) {
  return (
    <li
      role="treeitem"
      aria-selected="false"
      className="flex items-center gap-2 py-0.5"
    >
      {icon ? (
        customIcon(icon)
      ) : (
        <FileIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      <span className="font-mono text-[0.8125rem]">{name}</span>
    </li>
  );
}

export interface TreeFolderProps {
  name: string;
  defaultOpen?: boolean;
  /** Replaces the folder icon, open and closed. Use `openIcon` to show a different one when open. */
  icon?: ReactNode;
  /** Icon shown while the folder is open. Defaults to `icon`. */
  openIcon?: ReactNode;
  children?: ReactNode;
}

export function TreeFolder({
  name,
  defaultOpen = false,
  icon,
  openIcon,
  children,
}: TreeFolderProps) {
  return (
    <li
      role="treeitem"
      aria-expanded={defaultOpen}
      aria-selected="false"
      className="py-0.5"
    >
      <details open={defaultOpen} className="dk-anim-details group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {icon ? (
            openIcon ? (
              <>
                <span className="contents group-open:hidden">
                  {customIcon(icon)}
                </span>
                <span className="hidden group-open:contents">
                  {customIcon(openIcon)}
                </span>
              </>
            ) : (
              customIcon(icon)
            )
          ) : (
            <>
              <FolderIcon
                className="size-4 shrink-0 text-primary group-open:hidden"
                aria-hidden="true"
              />
              <FolderOpen
                className="hidden size-4 shrink-0 text-primary group-open:block"
                aria-hidden="true"
              />
            </>
          )}
          <span className="font-mono text-[0.8125rem] font-medium">{name}</span>
        </summary>
        <ul role="group" className="m-0 ml-2 list-none border-l pl-3">
          {children}
        </ul>
      </details>
    </li>
  );
}

/** A file tree. `Tree.Folder` and `Tree.File` are its parts. */
const folderDepth = (parents: readonly string[]) => parents.filter((p) => p === 'Tree.Folder' || p === 'Folder').length;
TreeFolder.toMarkdown = ((props, children, { parents }) =>
  `${md.item(`${props.name}/`, folderDepth(parents))}\n${md.trimBlank(children)}`) satisfies ToMarkdown<{ name: string }>;
TreeFile.toMarkdown = ((props, _children, { parents }) =>
  md.item(props.name, folderDepth(parents))) satisfies ToMarkdown<{ name: string }>;

export const Tree = Object.assign(TreeRoot, {
  toMarkdown: md.container,
  Folder: TreeFolder,
  File: TreeFile,
});

/** The same as `Tree`, `Tree.Folder` and `Tree.File`, under the names other tools use. */
export const Files = Tree;
export const Folder = TreeFolder;
export const File = TreeFile;
export type FileProps = TreeFileProps;
export type FolderProps = TreeFolderProps;
