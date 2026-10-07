'use client';

import { type ComponentProps, Suspense, lazy } from 'react';

// The assistant is only needed when someone asks, so its code (the conversation, the answer renderer, the stream reader)
// is fetched then, not with every page.
const AskViewImpl = lazy(() =>
  import('./ask-view.tsx').then((m) => ({ default: m.AskView })),
);

/** `AskView`, loaded on first use. */
export function LazyAskView(props: ComponentProps<typeof AskViewImpl>) {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-24 flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
          role="status"
        >
          Loading the assistant…
        </div>
      }
    >
      <AskViewImpl {...props} />
    </Suspense>
  );
}
