import type { Environment } from '@dockudos/core';
import { act, renderHook } from '@testing-library/react';

// The mirror lives for the life of the module, so each test starts from a fresh copy of it.
const fresh = async () => {
  vi.resetModules();
  return import('./client-env.ts');
};

const environment = (over: Partial<Environment> = {}): Environment => ({
  id: 'e1',
  name: 'Sandbox',
  order: 1,
  variables: [
    { name: 'baseUrl', value: 'https://api.test' },
    { name: 'token', value: 'sk-live-1', secret: true },
  ],
  v: 1,
  ...over,
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the environment mirror', () => {
  it('writes what endpoint pages read, and keeps no secret value in it', async () => {
    const { writeEnvironments, ENV_MIRROR_KEY, readEnvironments } = await fresh();
    writeEnvironments({ activeId: 'e1', environments: [environment()] });
    const stored = JSON.parse(localStorage.getItem(ENV_MIRROR_KEY) as string) as {
      activeId: string;
      environments: Environment[];
    };
    expect(stored.activeId).toBe('e1');
    expect(stored.environments[0]?.variables).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: '', secret: true },
    ]);
    expect(localStorage.getItem(ENV_MIRROR_KEY)).not.toContain('sk-live-1');
    // What is held in memory still has the value, so the page that wrote it can send with it.
    expect(readEnvironments().environments[0]?.variables[1]?.value).toBe('sk-live-1');
  });

  it('reads a mirror another tab wrote, skipping what it cannot read', async () => {
    const { ENV_MIRROR_KEY } = await fresh();
    localStorage.setItem(
      ENV_MIRROR_KEY,
      JSON.stringify({
        activeId: 'e1',
        environments: [
          environment(),
          'nope',
          { name: 'no id' },
          { id: 'e2', variables: 'nope' },
        ],
      }),
    );
    const { readEnvironments } = await fresh();
    const mirror = readEnvironments();
    expect(mirror.environments.map((e) => e.name)).toEqual(['Sandbox', 'Environment']);
    expect(mirror.environments[1]).toMatchObject({ id: 'e2', order: 0, variables: [] });
  });

  it('starts empty when there is nothing, or something unreadable, in storage', async () => {
    const { ENV_MIRROR_KEY } = await fresh();
    localStorage.setItem(ENV_MIRROR_KEY, '{nope');
    const first = await fresh();
    expect(first.readEnvironments()).toEqual({ environments: [] });
    localStorage.clear();
    const second = await fresh();
    expect(second.readEnvironments().environments).toEqual([]);
  });

  it('keeps working when storage is blocked', async () => {
    const { writeEnvironments, writeSecrets, readEnvironments } = await fresh();
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    writeEnvironments({ activeId: 'e1', environments: [environment()] });
    writeSecrets({ e1: { token: 'sk-live-1' } });
    expect(readEnvironments().activeId).toBe('e1');
    blocked.mockRestore();
  });
});

describe('the values a request resolves against', () => {
  it('uses the chosen environment and says which variables are secret', async () => {
    const { writeEnvironments, activeEnvironment } = await fresh();
    writeEnvironments({ activeId: 'e1', environments: [environment()] });
    expect(activeEnvironment()).toMatchObject({
      values: { baseUrl: 'https://api.test', token: 'sk-live-1' },
      secretNames: ['token'],
    });
  });

  it('has no values when nothing is chosen, and sorts the list for the picker', async () => {
    const { writeEnvironments, activeEnvironment } = await fresh();
    writeEnvironments({
      environments: [environment({ id: 'e2', name: 'Live', order: 2 }), environment()],
    });
    const active = activeEnvironment();
    expect(active.active).toBeUndefined();
    expect(active.values).toEqual({});
    expect(active.environments.map((e) => e.name)).toEqual(['Sandbox', 'Live']);
  });

  it('puts the secret this tab holds back into an environment that was stored without it', async () => {
    const { ENV_MIRROR_KEY, ENV_SECRETS_KEY } = await fresh();
    localStorage.setItem(
      ENV_MIRROR_KEY,
      JSON.stringify({
        activeId: 'e1',
        environments: [
          {
            ...environment(),
            variables: [
              { name: 'baseUrl', value: 'https://api.test' },
              { name: 'token', value: '', secret: true },
            ],
          },
        ],
      }),
    );
    sessionStorage.setItem(ENV_SECRETS_KEY, JSON.stringify({ e1: { token: 'from-the-tab' } }));
    const { activeEnvironment } = await fresh();
    expect(activeEnvironment().values).toEqual({
      baseUrl: 'https://api.test',
      token: 'from-the-tab',
    });
  });

  it('leaves a secret empty when the tab holds none', async () => {
    const { writeEnvironments, activeEnvironment } = await fresh();
    writeEnvironments({
      activeId: 'e1',
      environments: [{ ...environment(), variables: [{ name: 'token', value: '', secret: true }] }],
    });
    expect(activeEnvironment().values).toEqual({ token: '' });
  });
});

describe('useEnvironment', () => {
  it('follows a change made here and one made in another tab', async () => {
    const { useEnvironment, writeEnvironments, chooseEnvironment, ENV_MIRROR_KEY } =
      await fresh();
    const { result } = renderHook(() => useEnvironment());
    expect(result.current.environments).toEqual([]);

    act(() => writeEnvironments({ environments: [environment()] }));
    expect(result.current.environments).toHaveLength(1);
    expect(result.current.active).toBeUndefined();

    act(() => chooseEnvironment('e1'));
    expect(result.current.active?.name).toBe('Sandbox');
    expect(result.current.values.baseUrl).toBe('https://api.test');

    // Another tab replaced the mirror: the picker here follows it.
    localStorage.setItem(
      ENV_MIRROR_KEY,
      JSON.stringify({ environments: [environment({ name: 'Renamed elsewhere' })] }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: ENV_MIRROR_KEY }));
    });
    expect(result.current.environments[0]?.name).toBe('Renamed elsewhere');
  });

  it('forgets a secret when the tab clears it', async () => {
    const { useEnvironment, writeEnvironments, writeSecrets } = await fresh();
    writeEnvironments({ activeId: 'e1', environments: [environment()] });
    const { result } = renderHook(() => useEnvironment());
    expect(result.current.values.token).toBe('sk-live-1');
    act(() => writeSecrets({}));
    expect(result.current.secretNames).toEqual(['token']);
  });

  it('unsubscribes when the component goes', async () => {
    const { useEnvironment, writeEnvironments } = await fresh();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useEnvironment());
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
    // Writing afterwards does not throw with nobody listening.
    expect(() => writeEnvironments({ environments: [] })).not.toThrow();
  });
});
