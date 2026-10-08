import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

export interface FrameProps {
  /** Shown under the content and used as its caption. */
  caption?: string;
  /** A short note above the content, such as "Click to zoom". */
  hint?: string;
  children: ReactNode;
}

/** A bordered frame for an image, video or diagram, with an optional caption. */
export function Frame({ caption, hint, children }: FrameProps) {
  return (
    <figure className="not-prose my-5 overflow-hidden rounded-lg border bg-muted/30">
      {hint && (
        <p className="m-0 border-b px-3 py-1.5 text-center text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="flex justify-center p-3 [&_img]:rounded-md [&_img]:shadow-sm [&_svg]:max-w-full [&_video]:max-w-full">
        {children}
      </div>
      {caption && (
        <figcaption className="border-t px-3 py-2 text-center text-sm text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

Frame.toMarkdown = ((props, children) =>
  md.section(undefined, `${children.trim()}${props.caption ? `\n\n${md.italic(String(props.caption))}` : ''}`)) satisfies ToMarkdown<{
  caption?: string;
}>;
