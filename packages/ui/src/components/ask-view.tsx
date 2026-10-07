'use client';

import type { AskContext, AskSource } from '@dockudos/core';
import { RotateCcw, SendHorizontal, Square } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type AskState,
  type AskStore,
  type AskTurn,
  getAskStore,
} from '../lib/ask-store.ts';
import { useNavigate } from '../provider.tsx';
import { AnswerText } from './answer.tsx';

/** What the server renders: no conversation. One object, because React compares snapshots by identity. */
const SERVER_STATE: AskState = { turns: [], busy: false };
const getServerState = () => SERVER_STATE;

/** The store for an ask route, as React state. */
export function useAsk(store: AskStore) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    getServerState,
  );
  return { ...state, ask: store.ask, stop: store.stop, reset: store.reset };
}

const sourceLabel = (s: AskSource) => [s.title, ...s.headingPath].join(' › ');

function SourceLinks({
  title,
  sources,
  numbered,
  onNavigate,
}: {
  title: string;
  sources: readonly AskSource[];
  numbered: boolean;
  onNavigate: (url: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-2 text-xs">
      <p className="mb-1 font-medium text-muted-foreground">{title}</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {sources.map((s) => (
          <li key={`${s.n}-${s.url}`} className="flex gap-1.5">
            {numbered && (
              <span className="text-muted-foreground" aria-hidden="true">
                {s.n}.
              </span>
            )}
            <a
              href={s.url}
              className="min-w-0 truncate text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onNavigate(s.url);
              }}
            >
              {sourceLabel(s)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Turn({
  turn,
  onNavigate,
}: {
  turn: AskTurn;
  onNavigate: (url: string) => void;
}) {
  if (turn.role === 'user')
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">
        <span className="sr-only">You asked: </span>
        {turn.text}
      </div>
    );

  const cited = turn.citations.flatMap((n) => {
    const s = turn.sources.find((x) => x.n === n);
    return s ? [s] : [];
  });
  return (
    <div className="max-w-full text-sm" aria-busy={turn.status === 'streaming'}>
      <span className="sr-only">Answer: </span>
      {turn.text ? (
        <AnswerText text={turn.text} sources={turn.sources} onNavigate={onNavigate} />
      ) : turn.status === 'streaming' ? (
        <p className="text-muted-foreground">Looking through the docs…</p>
      ) : null}
      {turn.status === 'stopped' && (
        <p className="mt-1 text-xs text-muted-foreground">Stopped.</p>
      )}
      {turn.flagged === 'uncited' && (
        <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
          This answer does not point to a source. Check it against the pages below.
        </p>
      )}
      {turn.error && (
        <p role="alert" className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs">
          {turn.error}
        </p>
      )}
      {turn.status !== 'streaming' && (
        <>
          <SourceLinks title="Sources" sources={cited} numbered onNavigate={onNavigate} />
          <SourceLinks
            title={cited.length ? 'Related pages' : 'Pages that may help'}
            sources={turn.related}
            numbered={false}
            onNavigate={onNavigate}
          />
        </>
      )}
    </div>
  );
}

/**
 * The conversation with the docs assistant: the questions and answers so far, and a box to ask the next one. Answers
 * stream in; `[1]` in the text links to the numbered sources listed under it. Used in the palette and in the side panel.
 */
export function AskView({
  endpoint = '/api/ask',
  store,
  maxQuestionLength = 500,
  onNavigate,
  autoFocus = true,
  initialQuestion,
  context,
}: {
  endpoint?: string;
  /** Use a store of your own instead of the shared one for `endpoint`. */
  store?: AskStore;
  maxQuestionLength?: number;
  /** Called after a source link is followed, for example to close the dialog the view is in. */
  onNavigate?: () => void;
  autoFocus?: boolean;
  /** A question to send as soon as the view appears, once. */
  initialQuestion?: string;
  /** Where the reader is, for hosts that embed the assistant in their own product. */
  context?: AskContext;
}) {
  const shared = store ?? getAskStore(endpoint);
  const { turns, busy, ask, stop, reset } = useAsk(shared);
  const contextKey = JSON.stringify(context ?? null);
  useEffect(() => {
    shared.setContext(context);
  }, [shared, contextKey]);
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const sent = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialQuestion && sent.current !== initialQuestion) {
      sent.current = initialQuestion;
      void ask(initialQuestion);
    }
  }, [initialQuestion, ask]);

  // Keep the newest text in view while it streams.
  const last = turns.at(-1);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.text, last?.status]);

  const go = (url: string) => {
    navigate(url);
    onNavigate?.();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft('');
    void ask(question);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter adds a line; a key that is part of typing in an input method does neither.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the assistant"
        className="min-h-24 flex-1 space-y-4 overflow-y-auto p-4"
      >
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a question about the documentation. Answers cite the pages they come from.
          </p>
        )}
        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} onNavigate={go} />
        ))}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
        <label htmlFor={`${id}-q`} className="sr-only">
          Ask a question
        </label>
        <textarea
          id={`${id}-q`}
          ref={input}
          autoFocus={autoFocus}
          rows={1}
          value={draft}
          maxLength={maxQuestionLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question…"
          className="max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Stop answering"
          >
            <Square className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            aria-label="Send question"
          >
            <SendHorizontal className="size-4" aria-hidden="true" />
          </button>
        )}
        {turns.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => {
              reset();
              input.current?.focus();
            }}
            className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Start a new conversation"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
