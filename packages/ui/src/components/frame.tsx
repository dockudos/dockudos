import type { ReactNode } from 'react';

export interface FrameProps {
  /** Shown under the content and used as its caption. */
  caption?: string;
  children: ReactNode;
}

/** A bordered frame for an image, video or diagram, with an optional caption. */
export function Frame({ caption, children }: FrameProps) {
  return (
    <figure className="not-prose my-5 overflow-hidden rounded-lg border bg-muted/30">
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
