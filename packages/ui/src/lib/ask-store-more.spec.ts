import { createAskStore, getAskStore } from './ask-store.ts';

const raw = (body: string) => new Response(body);
const asked = async (store: ReturnType<typeof createAskStore>) => {
  await store.ask('q');
  return store.getState().turns.at(-1);
};

describe('createAskStore edges', () => {
  it('keeps nothing when the tab has no session storage', async () => {
    vi.stubGlobal('sessionStorage', undefined);
    try {
      const store = createAskStore({
        fetch: async () => raw('data: {"type":"done","citations":[]}\n\n'),
      });
      await store.ask('q');
      expect(store.getState().turns).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps nothing when session storage is blocked', () => {
    const blocked = vi
      .spyOn(window, 'sessionStorage', 'get')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    try {
      expect(createAskStore().getState().turns).toEqual([]);
    } finally {
      blocked.mockRestore();
    }
  });

  it('uses the page’s global fetch and the default route', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(raw('data: {"type":"done","citations":[]}\n\n'));
    const store = createAskStore({ storage: null });
    await store.ask('q');
    expect(spy.mock.calls[0]?.[0]).toBe('/api/ask');
    spy.mockRestore();
  });

  it('keeps its default message when a failed answer says nothing useful', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () => new Response(JSON.stringify({}), { status: 503 }),
    });
    expect((await asked(store))?.error).toBe(
      'The assistant is unavailable (503).',
    );
  });

  it('treats an answer with no body as a failure to reach the assistant', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () => new Response(null),
    });
    expect((await asked(store))?.error).toContain(
      'Could not reach the assistant',
    );
  });

  it('skips an event it cannot read and goes on', async () => {
    const store = createAskStore({
      storage: null,
      fetch: async () =>
        raw(
          'data: {nope\n\ndata: {"type":"token","text":"Hi"}\n\ndata: {"type":"done","citations":[]}\n\n',
        ),
    });
    expect((await asked(store))?.text).toBe('Hi');
  });

  it('shares one store per route', () => {
    expect(getAskStore()).toBe(getAskStore('/api/ask'));
    expect(getAskStore('/api/other')).not.toBe(getAskStore());
  });
});
