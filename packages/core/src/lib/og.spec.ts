import {
  OG_SIZE,
  ogElement,
  ogImagePath,
  pathFromOgImage,
  readableOn,
} from './og.ts';

describe('image addresses', () => {
  it('maps a page to its image and back', () => {
    expect(ogImagePath('/')).toBe('/og/index.png');
    expect(ogImagePath('/guides/auth')).toBe('/og/guides/auth.png');
    expect(ogImagePath('/fr/v1')).toBe('/og/fr/v1.png');
    for (const path of ['/', '/guides/auth', '/fr', '/v1/fr/guides/a'])
      expect(pathFromOgImage(ogImagePath(path))).toBe(path);
  });
  it('treats a folder index as the folder, and ignores other addresses', () => {
    expect(pathFromOgImage('/og/guides/index.png')).toBe('/guides');
    expect(pathFromOgImage('/og/x.jpg')).toBeUndefined();
    expect(pathFromOgImage('/other/x.png')).toBeUndefined();
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe('readableOn', () => {
  it.each([
    ['#000000', '#ffffff'],
    ['#ffffff', '#000000'],
    ['#111827', '#ffffff'],
    ['#5DD988', '#000000'],
    ['#fff', '#000000'],
    ['#3b82f6', '#000000'],
    ['#1e3a8a', '#ffffff'],
    ['nonsense', '#ffffff'],
  ])('%s -> %s', (bg, fg) => expect(readableOn(bg)).toBe(fg));
});

describe('ogElement', () => {
  const text = (node: unknown): string =>
    typeof node === 'string'
      ? node
      : Array.isArray(node)
        ? node.map(text).join('|')
        : node && typeof node === 'object'
          ? text((node as { props?: { children?: unknown } }).props?.children)
          : '';

  it('puts the site, title, description and badge on a brand-colored card with readable text', () => {
    const card = ogElement({
      siteName: 'Acme',
      title: 'Authentication',
      description: 'Sign in.',
      badge: 'v2',
      primary: '#5DD988',
    });
    expect(card.props.style).toMatchObject({
      background: '#5DD988',
      color: '#000000',
    });
    expect(text(card)).toBe('Acme|v2|Authentication|Sign in.');
  });

  it('falls back to a dark card, omits what is missing and clips long text', () => {
    const card = ogElement({
      siteName: 'A'.repeat(100),
      title: 'T '.repeat(100),
      primary: 'red',
    });
    expect(card.props.style).toMatchObject({
      background: '#111827',
      color: '#ffffff',
    });
    const shown = text(card).split('|').filter(Boolean);
    expect(shown[0]).toHaveLength(40);
    expect(shown[1]?.length).toBeLessThanOrEqual(90);
    expect(shown[1]).toMatch(/…$/);
    expect(shown).toHaveLength(2);
  });
});
