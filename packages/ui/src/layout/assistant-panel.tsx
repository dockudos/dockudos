'use client';

import { Sparkles, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { AskView } from '../components/ask-view.tsx';
import { Shortcut } from '../components/shortcut.tsx';
import { useHotkey } from '../hooks/use-hotkey.ts';

const OPEN_EVENT = 'dockudos:assistant';

/** Open the assistant panel from anywhere, optionally with a question to ask straight away. */
export const openAssistant = (question?: string) =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: question }));

/** The "Ask AI" button for the navbar. */
export function AssistantButton() {
  return (
    <button
      type="button"
      onClick={() => openAssistant()}
      className="dk-ask-button inline-flex h-8 items-center gap-1.5 rounded-md border bg-muted px-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-keyshortcuts="Control+I Meta+I"
      aria-label="Ask the docs"
    >
      <Sparkles className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline">Ask AI</span>
    </button>
  );
}

/**
 * A side panel with the assistant, for reading a page and asking about it at the same time. Opens with
 * Cmd or Ctrl + I, the navbar button, or `openAssistant()`. The conversation is shared with the palette.
 */
export function AssistantPanel({
  endpoint,
  maxQuestionLength,
}: {
  endpoint?: string;
  maxQuestionLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<string | undefined>();

  useHotkey('mod+i', () => setOpen((o) => !o), {
    description: 'Ask the assistant',
    group: 'General',
    allowInInputs: true,
  });
  useEffect(() => {
    const show = (e: Event) => {
      const asked = (e as CustomEvent<string | undefined>).detail;
      setQuestion(asked);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuestion(undefined);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l bg-background shadow-2xl data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="size-4" aria-hidden="true" /> Ask the docs
              <Shortcut keys="mod+i" />
            </Dialog.Title>
            <Dialog.Close
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <AskView
            endpoint={endpoint}
            maxQuestionLength={maxQuestionLength}
            initialQuestion={question}
            onNavigate={() => setOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
