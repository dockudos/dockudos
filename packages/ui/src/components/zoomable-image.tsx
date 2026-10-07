'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ImgHTMLAttributes } from 'react';

/** An image that opens full size in a dialog on click, Enter or Space. Esc closes it. */
export function ZoomableImage({ alt = '', className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="block max-w-full cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={alt ? `Zoom image: ${alt}` : 'Zoom image'}
        >
          <img alt={alt} loading="lazy" decoding="async" className={className} {...props} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <Dialog.Content className="fixed inset-4 z-50 flex items-center justify-center outline-none" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{alt || 'Image'}</Dialog.Title>
          <img src={props.src} srcSet={props.srcSet} alt={alt} className="max-h-full max-w-full rounded-lg object-contain" />
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
