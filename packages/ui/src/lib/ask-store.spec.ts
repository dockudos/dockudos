import type { AskEvent } from '@dockudos/core';
import { createAskStore } from './ask-store.ts';

const sse = (...events: AskEvent[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const source = {
  n: 1,
  title: 'Auth',
  path: '/auth',
  anchor: 'keys',
  url: '/auth#keys',
  headingPath: ['Keys'],
};

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const answer = (text = 'Rotate it [1].') =>
  sse(
    { type: 'sources', items: [source] },
    { type: 'token', text: text.slice(0, 5) },
    { type: 'token', text: text.slice(5) },
    { type: 'done', citations: [1] },
  );

describe('createAskStore', () => {
  it('sends the question and reads the stream into an answer turn', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => answer());
    const store = createAskStore({
      fetch: fetch as typeof globalThis.fetch,
      storage: null,
    });
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.getState().busy));
    await store.ask('  How do I rotate a key?  ');

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ask');
    expect(JSON.parse(init.body as string)).toEqual({
      question: 'How do I rotate a key?',
      history: [],
    });
    const { turns, busy } = store.getState();
    expect(busy).toBe(false);
    expect(seen).toContain(true);
    expect(turns.map((t) => [t.role, t.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'done'],
    ]);
    expect(turns[1]).toMatchObject({
      text: 'Rotate it [1].',
      sources: [source],
      citations: [1],
    });
  });

  it('sends earlier turns as history so follow-ups have context', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => answer());
    const store = createAskStore({
      fetch: fetch as typeof globalThis.fetch,
      storage: null,
    });
    await store.ask('first');
    await store.ask('second');
    const body = JSON.parse(
      (fetch.mock.calls[1]?.[1] as RequestInit).body as string,
    );
    expect(body.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'Rotate it [1].' },
    ]);
  });

  it('keeps refusals, related pages and flags', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () =>
        sse(
          { type: 'token', text: 'Not found.' },
          {
            type: 'done',
            citations: [],
            refused: 'no-context',
            related: [source],
          },
        ),
    });
    await store.ask('q');
    expect(store.getState().turns[1]).toMatchObject({
      refused: 'no-context',
      related: [source],
      status: 'done',
    });
  });

  it('shows the server’s message for a refused request', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () =>
        new Response(
          '{"error":"Too many questions. Try again in 12 seconds."}',
          {
            status: 429,
          },
        ),
    });
    await store.ask('q');
    expect(store.getState().turns[1]).toMatchObject({
      status: 'error',
      error: 'Too many questions. Try again in 12 seconds.',
    });
    expect(store.getState().busy).toBe(false);
  });

  it('explains a network failure and a cut-off stream', async () => {
    const down = createAskStore({
      storage: null,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await down.ask('q');
    expect(down.getState().turns[1]?.error).toContain(
      'Could not reach the assistant',
    );

    const cut = createAskStore({
      storage: null,
      fetch: async () => sse({ type: 'token', text: 'Half an ans' }),
    });
    await cut.ask('q');
    expect(cut.getState().turns[1]).toMatchObject({
      status: 'error',
      text: 'Half an ans',
      error: 'The answer was cut off. Try again.',
    });
  });

  it('shows an error event from the server', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () => sse({ type: 'error', message: 'The model is busy.' }),
    });
    await store.ask('q');
    expect(store.getState().turns[1]).toMatchObject({
      status: 'error',
      error: 'The model is busy.',
    });
  });

  it('stops a running answer and keeps what arrived', async () => {
    let release: () => void = () => undefined;
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          release = () => reject(new DOMException('aborted', 'AbortError'));
          init.signal?.addEventListener('abort', release);
        }),
    );
    const store = createAskStore({ fetch: fetch as never, storage: null });
    const pending = store.ask('q');
    expect(store.getState().busy).toBe(true);
    store.stop();
    await pending;
    expect(store.getState().turns[1]?.status).toBe('stopped');
    expect(store.getState().busy).toBe(false);
  });

  it('ignores a second question while one is being answered, and blank ones', async () => {
    const fetch = vi.fn(async () => answer());
    const store = createAskStore({ fetch, storage: null });
    const first = store.ask('one');
    await store.ask('two');
    await store.ask('   ');
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('remembers the conversation for the tab and can forget it', async () => {
    const storage = memory();
    const first = createAskStore({ fetch: async () => answer(), storage });
    await first.ask('q');
    expect(JSON.parse(storage.data.get('dockudos:ask') ?? '[]')).toHaveLength(
      2,
    );

    const next = createAskStore({ fetch: async () => answer(), storage });
    expect(next.getState().turns).toHaveLength(2);
    expect(next.getState().turns[1]?.text).toBe('Rotate it [1].');

    next.reset();
    expect(next.getState().turns).toEqual([]);
    expect(storage.data.has('dockudos:ask')).toBe(false);
  });

  it('copes with unreadable or full storage', async () => {
    const broken = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    const store = createAskStore({
      fetch: async () => answer(),
      storage: broken,
    });
    expect(store.getState().turns).toEqual([]);
    await expect(store.ask('q')).resolves.toBeUndefined();
    expect(store.getState().turns).toHaveLength(2);
  });

  it('keeps at most maxTurns turns', async () => {
    const store = createAskStore({
      fetch: async () => answer(),
      storage: null,
      maxTurns: 4,
    });
    for (const q of ['a', 'b', 'c']) await store.ask(q);
    expect(store.getState().turns).toHaveLength(4);
    expect(store.getState().turns[0]?.text).toBe('b');
  });
});
