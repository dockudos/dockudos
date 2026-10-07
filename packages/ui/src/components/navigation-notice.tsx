'use client';

import { Compass, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const EVENT = 'dockudos:navigated';

export interface NavigationNotice {
  /** Why the reader was taken here, in one line. */
  reason: string;
  /** Where they landed, for the label. */
  title: string;
}

/** Tell the reader why they were taken to this place. Shown by `NavigationNotice` once the page has changed. */
export const announceNavigation = (notice: NavigationNotice) =>
  window.dispatchEvent(new CustomEvent(EVENT, { detail: notice }));

const SHOWN_MS = 10_000;

/**
 * A short note at the bottom of the page after the palette took the reader somewhere ("This section explains how
 * to change the billing email."). It goes after ten seconds, or when closed. It lives above the pages (in
 * `DocsProvider`), so it survives the change of page.
 */
export function NavigationNoticeView() {
  const [notice, setNotice] = useState<NavigationNotice | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const show = (e: Event) => {
      setNotice((e as CustomEvent<NavigationNotice>).detail);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(undefined), SHOWN_MS);
    };
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener(EVENT, show);
      clearTimeout(timer.current);
    };
  }, []);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="dk-nav-notice fixed bottom-4 left-1/2 z-40 flex w-[min(34rem,92vw)] -translate-x-1/2 items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg"
    >
      <Compass className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1">
        <span className="font-medium">{notice.title}.</span> {notice.reason}
      </p>
      <button
        type="button"
        onClick={() => setNotice(undefined)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
