'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ImgHTMLAttributes } from 'react';

/** A URL, or the object a bundler produces for an imported image. */
export type ImageSource =
  | string
  | { src: string; width?: number; height?: number };

/** An image that opens full size in a dialog on click, Enter or Space. Esc closes it. */
export function ZoomableImage({
  alt = '',
  className,
  src,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src?: ImageSource }) {
  const url = typeof src === 'object' ? src.src : src;
  const width =
    props.width ?? (typeof src === 'object' ? src.width : undefined);
  const height =
    props.height ?? (typeof src === 'object' ? src.height : undefined);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="block max-w-full cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={alt ? `Zoom image: ${alt}` : 'Zoom image'}
        >
          <img
            {...props}
            src={url}
            width={width}
            height={height}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
          />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex items-center justify-center outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{alt || 'Image'}</Dialog.Title>
          <img
            src={url}
            alt={alt}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <Dialog.Close
            className="absolute top-0 right-0 inline-flex size-9 items-center justify-center rounded-full bg-background/90 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
