import { type AskEvent, type AskSource, readSse } from '@dockudos/core';

export interface AskTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'error' | 'stopped';
  /** The excerpts the answer was written from, numbered as `[n]` in the text. */
  sources: AskSource[];
  /** Numbers the answer cites. */
  citations: number[];
  /** Pages to suggest when there is no (reliable) answer. */
  related: AskSource[];
  refused?: 'no-context' | 'out-of-scope' | 'no-llm';
  flagged?: 'uncited';
  error?: string;
}

export interface AskState {
  turns: readonly AskTurn[];
  busy: boolean;
}

export interface AskStoreOptions {
  /** The ask route. Default `/api/ask`. */
  endpoint?: string;
  fetch?: typeof fetch;
  /** Where the conversation is kept between page loads. Default: the tab's `sessionStorage`, when there is one. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  storageKey?: string;
  /** Most turns kept. Default 20. */
  maxTurns?: number;
  /** Earlier turns sent with each question. Default 6. */
  historyTurns?: number;
}

export interface AskStore {
  getState(): AskState;
  subscribe(listener: () => void): () => void;
  /** Ask a question. Resolves when the answer is complete, stopped or failed; never rejects. */
  ask(question: string): Promise<void>;
  /** Stop the answer being written. */
  stop(): void;
  /** Forget the conversation. */
  reset(): void;
}

const empty = (): AskTurn => ({
  id: '',
  role: 'assistant',
  text: '',
  status: 'streaming',
  sources: [],
  citations: [],
  related: [],
});

function defaultStorage(): AskStoreOptions['storage'] {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // blocked
  }
}

/**
 * The conversation with the assistant: sends a question to the ask route, reads the stream of events into the
 * answer, keeps the turns so follow-ups have context, and remembers them for the tab. No framework involved.
 */
export function createAskStore(options: AskStoreOptions = {}): AskStore {
  const {
    endpoint = '/api/ask',
    maxTurns = 20,
    historyTurns = 6,
    storageKey = 'dockudos:ask',
  } = options;
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  let state: AskState = { turns: [], busy: false };
  let controller: AbortController | undefined;
  let counter = 0;
  const listeners = new Set<() => void>();
  let loaded = false;

  const emit = () => listeners.forEach((l) => l());
  const set = (next: AskState) => {
    state = next;
    emit();
  };
  const persist = () => {
    if (!storage) return;
    try {
      const settled = state.turns.filter((t) => t.status !== 'streaming');
      if (settled.length)
        storage.setItem(storageKey, JSON.stringify(settled.slice(-maxTurns)));
      else storage.removeItem(storageKey);
    } catch {
      /* full or blocked: the conversation still works for this page view */
    }
  };
  // Read the saved conversation the first time anyone looks, so nothing is read on the server.
  const load = () => {
    if (loaded) return;
    loaded = true;
    if (!storage) return;
    try {
      const raw = storage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as AskTurn[]) : [];
      if (Array.isArray(saved))
        state = { ...state, turns: saved.slice(-maxTurns) };
    } catch {
      /* unreadable: start fresh */
    }
  };

  const update = (id: string, change: (t: AskTurn) => AskTurn) =>
    set({
      ...state,
      turns: state.turns.map((t) => (t.id === id ? change(t) : t)),
    });

  const apply = (id: string, event: AskEvent) => {
    switch (event.type) {
      case 'sources':
        return update(id, (t) => ({ ...t, sources: event.items }));
      case 'token':
        return update(id, (t) => ({ ...t, text: t.text + event.text }));
      case 'done':
        return update(id, (t) => ({
          ...t,
          status: 'done',
          citations: event.citations,
          related: event.related ?? [],
          ...(event.refused && { refused: event.refused }),
          ...(event.flagged && { flagged: event.flagged }),
        }));
      case 'error':
        return update(id, (t) => ({
          ...t,
          status: 'error',
          error: event.message,
        }));
    }
  };

  return {
    getState() {
      load();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ask(question) {
      load();
      const text = question.trim();
      if (!text || state.busy) return;
      const history = state.turns
        .filter((t) => t.status === 'done' && t.text)
        .slice(-historyTurns)
        .map((t) => ({ role: t.role, content: t.text }));
      const id = `t${Date.now().toString(36)}${counter++}`;
      const answer: AskTurn = { ...empty(), id: `${id}a` };
      const asked: AskTurn = {
        ...empty(),
        id: `${id}q`,
        role: 'user',
        text,
        status: 'done',
      };
      set({
        busy: true,
        turns: [...state.turns, asked, answer].slice(-maxTurns),
      });
      controller = new AbortController();
      const { signal } = controller;
      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: text, history }),
          signal,
        });
        if (!response.ok) {
          let message = `The assistant is unavailable (${response.status}).`;
          try {
            const body = (await response.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            /* not JSON */
          }
          update(answer.id, (t) => ({ ...t, status: 'error', error: message }));
          return;
        }
        if (!response.body) throw new Error('empty');
        for await (const { data } of readSse(response.body)) {
          let event: AskEvent;
          try {
            event = JSON.parse(data) as AskEvent;
          } catch {
            continue;
          }
          apply(answer.id, event);
        }
        // A stream that ended without `done` was cut off.
        update(answer.id, (t) =>
          t.status === 'streaming'
            ? {
                ...t,
                status: 'error',
                error: 'The answer was cut off. Try again.',
              }
            : t,
        );
      } catch {
        update(answer.id, (t) =>
          signal.aborted
            ? { ...t, status: 'stopped' }
            : {
                ...t,
                status: 'error',
                error:
                  'Could not reach the assistant. Check your connection and try again.',
              },
        );
      } finally {
        controller = undefined;
        set({ ...state, busy: false });
        persist();
      }
    },
    stop() {
      controller?.abort();
    },
    reset() {
      controller?.abort();
      set({ turns: [], busy: false });
      persist();
    },
  };
}

const stores = new Map<string, AskStore>();

/** The one store for an ask route in this page, shared by the palette and the panel. */
export function getAskStore(endpoint = '/api/ask'): AskStore {
  let store = stores.get(endpoint);
  if (!store) stores.set(endpoint, (store = createAskStore({ endpoint })));
  return store;
}
