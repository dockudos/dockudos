import { Fragment } from 'react';
import { elementChildren } from './children.ts';
import { layoutGraph } from './graph-layout.ts';
import { requestNavigation } from './navigate-client.ts';

describe('elementChildren', () => {
  it('skips text, looks through fragments', () => {
    const found = elementChildren(
      <>
        text
        <b />
        <Fragment>
          <i />
        </Fragment>
      </>,
    );
    expect(found.map((e) => e.type)).toEqual(['b', 'i']);
    expect(elementChildren('just text')).toEqual([]);
  });
});

describe('layoutGraph', () => {
  it('does not divide by zero when nodes start in the same place', () => {
    // A size of 60 leaves no radius after the padding, so every node starts at the centre.
    const nodes = layoutGraph(['a', 'b', 'c'], [{ from: 'a', to: 'b' }], 60);
    expect(nodes).toHaveLength(3);
    for (const n of nodes) expect(Number.isFinite(n.x + n.y)).toBe(true);
  });
});

describe('requestNavigation', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it('uses the global fetch and the default route', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ url: '/guide', title: 'Guide', reason: 'r' }));
    const outcome = await requestNavigation('how');
    expect(outcome.kind).toBe('found');
    expect(spy.mock.calls[0]?.[0]).toBe('/api/navigate');
    spy.mockRestore();
  });

  it('says none for a 404, and uses the message of a failed answer', async () => {
    expect(await requestNavigation('q', { fetch: async () => json({}, 404) })).toEqual({
      kind: 'none',
    });
    expect(
      await requestNavigation('q', { fetch: async () => json({ error: 'Too many' }, 429) }),
    ).toEqual({ kind: 'error', message: 'Too many' });
    expect(
      await requestNavigation('q', { fetch: async () => json({}, 500) }),
    ).toEqual({ kind: 'error', message: 'Could not find a page (500).' });
    expect(
      await requestNavigation('q', { fetch: async () => new Response('oops', { status: 502 }) }),
    ).toEqual({ kind: 'error', message: 'Could not find a page (502).' });
  });

  it('rejects an answer that names no page on this site', async () => {
    for (const url of [undefined, 'https://elsewhere.test/x']) {
      expect(
        await requestNavigation('q', { fetch: async () => json({ url }) }),
      ).toEqual({ kind: 'error', message: 'The answer did not name a page.' });
    }
  });

  it('never rejects when the network fails', async () => {
    const outcome = await requestNavigation('q', {
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(outcome.kind).toBe('error');
  });
});
