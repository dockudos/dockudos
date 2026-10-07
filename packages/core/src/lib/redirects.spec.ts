import { RedirectError, resolveRedirects } from './redirects.ts';

const r = (source: string, destination: string, permanent = true) => ({
  source,
  destination,
  permanent,
});

describe('resolveRedirects', () => {
  it('passes simple redirects through', () => {
    expect(resolveRedirects([r('/old', '/new')])).toEqual([r('/old', '/new')]);
  });

  it('flattens chains to a single hop', () => {
    expect(
      resolveRedirects([r('/a', '/b'), r('/b', '/c'), r('/c', '/d')]),
    ).toEqual([r('/a', '/d'), r('/b', '/d'), r('/c', '/d')]);
  });

  it('is only permanent when every hop is', () => {
    const out = resolveRedirects([r('/a', '/b'), r('/b', '/c', false)]);
    expect(out[0]).toEqual(r('/a', '/c', false));
  });

  it('normalizes trailing slashes', () => {
    expect(resolveRedirects([r('/old/', '/new/')])).toEqual([
      r('/old', '/new'),
    ]);
  });

  it('keeps external destinations and stops chains there', () => {
    expect(resolveRedirects([r('/a', 'https://x.dev/b')])).toEqual([
      r('/a', 'https://x.dev/b'),
    ]);
  });

  it('leaves path patterns alone', () => {
    expect(resolveRedirects([r('/old/:slug*', '/new/:slug*')])).toEqual([
      r('/old/:slug*', '/new/:slug*'),
    ]);
  });

  it('rejects a self redirect and a longer loop', () => {
    expect(() => resolveRedirects([r('/a', '/a')])).toThrow(/loop: \/a -> \/a/);
    expect(() =>
      resolveRedirects([r('/a', '/b'), r('/b', '/c'), r('/c', '/a')]),
    ).toThrow(RedirectError);
  });

  it('rejects duplicate sources, naming the index', () => {
    expect(() => resolveRedirects([r('/a', '/b'), r('/a', '/c')])).toThrow(
      /redirects\[1\]: duplicate source "\/a"/,
    );
  });

  it('rejects a source that shadows a page', () => {
    expect(() => resolveRedirects([r('/guides', '/x')], ['/guides'])).toThrow(
      /existing page/,
    );
  });

  it('reports all problems together', () => {
    const run = () =>
      resolveRedirects([r('/a', '/a'), r('/b', '/c'), r('/b', '/d')]);
    expect(run).toThrow(/duplicate[\s\S]*loop/);
  });
});
