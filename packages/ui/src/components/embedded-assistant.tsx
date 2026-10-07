'use client';

import {
  type AskContext,
  EMBED_CLOSE_MESSAGE,
  EMBED_READY_MESSAGE,
  parseContextMessage,
} from '@dockudos/core';
import { ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocsProvider } from '../provider.tsx';
import { AskView } from './ask-view.tsx';

/**
 * The assistant as a page of its own, to be shown in a frame on another site (`/embed`). It fills the frame, takes
 * its colors from the docs, opens source links in a new tab (a frame cannot navigate its host), and listens for the
 * host to say where the reader is.
 */
export function EmbeddedAssistant({
  context: initial,
  endpoint,
  maxQuestionLength,
  name,
}: {
  /** Where the reader is, from the address of the frame. */
  context?: AskContext;
  endpoint?: string;
  maxQuestionLength?: number;
  /** The site's name, for the heading. */
  name?: string;
}) {
  const [context, setContext] = useState<AskContext | undefined>(initial);
  // Set once the page is interactive; until then the form is only markup that cannot be submitted yet.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only the page that holds this frame can say where the reader is.
      if (event.source !== window.parent) return;
      const next = parseContextMessage(event.data);
      if (next) setContext(Object.keys(next).length ? next : undefined);
    };
    window.addEventListener('message', onMessage);
    // Key presses inside a frame never reach the page around it, so Escape is passed on for it to close the frame.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.parent !== window)
        window.parent.postMessage({ type: EMBED_CLOSE_MESSAGE }, '*');
    };
    document.addEventListener('keydown', onKey);
    // Tell the host we can hear it now: a message sent while the page was still loading went nowhere. There is
    // nothing secret in this message, so any host may receive it.
    if (window.parent !== window)
      window.parent.postMessage({ type: EMBED_READY_MESSAGE }, '*');
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const open = (url: string) => {
    window.open(new URL(url, window.location.origin).toString(), '_blank', 'noopener,noreferrer');
  };

  return (
    <DocsProvider navigate={open}>
      <div
        className="flex h-dvh min-h-0 flex-col bg-background text-foreground"
        data-ready={ready}
      >
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <h1 className="m-0 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" aria-hidden="true" />
            Ask {name ? `the ${name} docs` : 'the docs'}
          </h1>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the docs
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </header>
        <AskView
          endpoint={endpoint}
          maxQuestionLength={maxQuestionLength}
          context={context}
          onNavigate={() => undefined}
        />
      </div>
    </DocsProvider>
  );
}
