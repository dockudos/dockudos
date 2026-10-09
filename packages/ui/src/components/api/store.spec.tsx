import { act, renderHook } from '@testing-library/react';

// The store keeps its state for the life of the module, so each test starts from a fresh copy.
const fresh = async () => {
  vi.resetModules();
  return import('./store.ts');
};

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('credentials', () => {
  it('starts from what the tab kept, shares changes, and keeps them in memory when storage is blocked', async () => {
    sessionStorage.setItem('dockudos-api-auth', JSON.stringify({ key: 'saved' }));
    const { useAuthValues } = await fresh();
    const { result } = renderHook(() => useAuthValues());
    expect(result.current[0]).toEqual({ key: 'saved' });
    act(() => result.current[1]('other', 'v'));
    expect(result.current[0]).toEqual({ key: 'saved', other: 'v' });
    expect(JSON.parse(sessionStorage.getItem('dockudos-api-auth') as string)).toEqual({ key: 'saved', other: 'v' });

    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    act(() => result.current[1]('third', 'x'));
    expect(result.current[0]).toMatchObject({ third: 'x' });
    blocked.mockRestore();
  });

  it('starts empty when what the tab kept is unreadable', async () => {
    sessionStorage.setItem('dockudos-api-auth', '{nope');
    const { useAuthValues } = await fresh();
    const { result } = renderHook(() => useAuthValues());
    expect(result.current[0]).toEqual({});
  });
});

describe('schemas on demand', () => {
  it('fetches each schema once, remembers it for later lookups, and forgets a failure so it can be retried', async () => {
    const { loadSchema, loadedSchema } = await fresh();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'string' })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'number' })));
    vi.stubGlobal('fetch', fetch);

    expect(loadedSchema('/s', 'A')).toBeUndefined();
    const first = loadSchema('/s', 'A');
    expect(loadSchema('/s', 'A')).toBe(first);
    expect(await first).toEqual({ type: 'string' });
    expect(loadedSchema('/s', 'A')).toEqual({ type: 'string' });
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(loadSchema('/s', 'B')).rejects.toThrow('404');
    await new Promise((r) => setTimeout(r, 0));
    expect(await loadSchema('/s', 'B')).toEqual({ type: 'number' });
  });
});
