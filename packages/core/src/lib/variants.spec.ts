import { parseConfig } from './config.ts';
import {
  alternates,
  buildVariantUi,
  allVariants,
  defaultVariant,
  isRtl,
  localeInfos,
  negotiateLocale,
  parseVariantPath,
  pathWithLocale,
  switchTarget,
  variantDir,
  variantKey,
  variantPrefix,
  versionBanner,
  versionInfos,
  type FindPage,
  type Located,
  type Variant,
} from './variants.ts';

const config = (extra: object = {}) =>
  parseConfig({
    name: 'X',
    versions: {
      default: 'v2',
      list: [
        { name: 'v2', label: '2.x' },
        { name: 'v1', status: 'deprecated', dir: 'legacy' },
        { name: 'next', status: 'unreleased' },
      ],
    },
    i18n: {
      default: 'en',
      locales: ['en', { code: 'ar', label: 'العربية' }, 'fr', 'pt-BR'],
    },
    ...extra,
  });

describe('config validation', () => {
  it('rejects a default that is not listed', () => {
    expect(() =>
      parseConfig({
        name: 'X',
        versions: { default: 'v9', list: [{ name: 'v1' }] },
      }),
    ).toThrow(/not in the list of versions/);
    expect(() =>
      parseConfig({ name: 'X', i18n: { default: 'de', locales: ['en'] } }),
    ).toThrow(/not in the list of locales/);
  });

  it('rejects duplicates and a version named like a language', () => {
    expect(() =>
      parseConfig({
        name: 'X',
        versions: { default: 'v1', list: [{ name: 'v1' }, { name: 'v1' }] },
      }),
    ).toThrow(/listed twice/);
    expect(() =>
      parseConfig({
        name: 'X',
        versions: { default: 'v1', list: [{ name: 'v1' }, { name: 'fr' }] },
        i18n: { default: 'en', locales: ['en', 'fr'] },
      }),
    ).toThrow(/also a language code/);
  });
});

describe('infos', () => {
  it('lists the default language first, with labels and direction', () => {
    const infos = localeInfos(config());
    expect(infos.map((l) => l.code)).toEqual(['en', 'ar', 'fr', 'pt-BR']);
    expect(infos.find((l) => l.code === 'ar')).toMatchObject({
      label: 'العربية',
      rtl: true,
    });
    expect(infos.find((l) => l.code === 'fr')).toMatchObject({
      label: 'Français',
      rtl: false,
    });
    expect(isRtl('he')).toBe(true);
    expect(isRtl('pt-BR')).toBe(false);
  });

  it('gives versions a label, folder and status', () => {
    expect(
      versionInfos(config()).map((v) => [
        v.name,
        v.label,
        v.dir,
        v.status,
        v.isDefault,
      ]),
    ).toEqual([
      ['v2', '2.x', 'v2', 'stable', true],
      ['v1', 'v1', 'legacy', 'deprecated', false],
      ['next', 'next', 'next', 'unreleased', false],
    ]);
  });

  it('is empty for a site with neither', () => {
    const plain = parseConfig({ name: 'X' });
    expect(localeInfos(plain)).toEqual([]);
    expect(versionInfos(plain)).toEqual([]);
    expect(allVariants(plain)).toEqual([{}]);
    expect(variantDir(plain, {})).toBe('');
  });
});

describe('variants, prefixes and folders', () => {
  it('enumerates every combination, defaults first', () => {
    const all = allVariants(config());
    expect(all).toHaveLength(12);
    expect(all[0]).toEqual({ locale: 'en', version: 'v2' });
    expect(all.map(variantKey)).toContain('legacy'.replace('legacy', 'v1/fr'));
    expect(defaultVariant(config())).toEqual({ locale: 'en', version: 'v2' });
  });

  it('leaves the defaults out of the address and puts them in the folder', () => {
    const c = config();
    expect(variantPrefix(c, { version: 'v2', locale: 'en' })).toBe('');
    expect(variantPrefix(c, { version: 'v1', locale: 'en' })).toBe('/v1');
    expect(variantPrefix(c, { version: 'v2', locale: 'fr' })).toBe('/fr');
    expect(variantPrefix(c, { version: 'v1', locale: 'fr' })).toBe('/v1/fr');
    expect(variantDir(c, { version: 'v1', locale: 'fr' })).toBe('legacy/fr');
    expect(variantDir(c, { version: 'v2', locale: 'en' })).toBe('v2/en');
  });

  it('works with only versions or only languages', () => {
    const onlyVersions = parseConfig({
      name: 'X',
      versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
    });
    expect(variantDir(onlyVersions, { version: 'v1' })).toBe('v1');
    expect(variantPrefix(onlyVersions, { version: 'v1' })).toBe('/v1');
    const onlyLocales = parseConfig({
      name: 'X',
      i18n: { default: 'en', locales: ['en', 'fr'] },
    });
    expect(variantDir(onlyLocales, { locale: 'fr' })).toBe('fr');
    expect(allVariants(onlyLocales)).toEqual([
      { locale: 'en' },
      { locale: 'fr' },
    ]);
  });
});

describe('parseVariantPath', () => {
  const c = config();
  it('reads version then language off the front', () => {
    expect(parseVariantPath(c, ['v1', 'fr', 'guides', 'a'])).toEqual({
      variant: { version: 'v1', locale: 'fr' },
      rest: ['guides', 'a'],
      redundant: false,
      explicitVersion: true,
      explicitLocale: true,
    });
    expect(parseVariantPath(c, ['fr', 'guides']).variant).toEqual({
      version: 'v2',
      locale: 'fr',
    });
    expect(parseVariantPath(c, ['v1']).variant).toEqual({
      version: 'v1',
      locale: 'en',
    });
    expect(parseVariantPath(c, ['guides', 'a'])).toMatchObject({
      variant: { version: 'v2', locale: 'en' },
      rest: ['guides', 'a'],
    });
  });

  it('flags addresses that spell out a default', () => {
    expect(parseVariantPath(c, ['en', 'x'])).toMatchObject({
      redundant: true,
      rest: ['x'],
    });
    expect(parseVariantPath(c, ['v2', 'x'])).toMatchObject({
      redundant: true,
      rest: ['x'],
    });
  });

  it('does not read a language before a version', () => {
    expect(parseVariantPath(c, ['fr', 'v1', 'x'])).toMatchObject({
      variant: { version: 'v2', locale: 'fr' },
      rest: ['v1', 'x'],
    });
  });

  it('leaves a plain site alone', () => {
    expect(parseVariantPath(parseConfig({ name: 'X' }), ['a', 'b'])).toEqual({
      variant: {},
      rest: ['a', 'b'],
      redundant: false,
      explicitVersion: false,
      explicitLocale: false,
    });
  });
});

describe('negotiateLocale', () => {
  const codes = ['en', 'fr', 'pt-BR'];
  it.each([
    ['fr-CA,fr;q=0.9,en;q=0.8', 'fr'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['de,en;q=0.5', 'en'],
    ['de', 'en'],
    ['*', 'en'],
    ['fr;q=0,en', 'en'],
    ['en;q=0.2,fr;q=0.9', 'fr'],
    ['', 'en'],
    [undefined, 'en'],
    ['PT-br', 'pt-BR'],
  ])('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header, codes, 'en')).toBe(expected);
  });
});

// A tiny corpus: v2 has /guides/auth in en and fr, /guides/new only in en (stand-in in fr); v1 has /guides/auth in en only.
const corpus = new Map<string, Located>();
const add = (v: Variant, rel: string, fallbackLocale?: string) =>
  corpus.set(`${variantKey(v)}|${rel}`, {
    rel,
    path: variantPrefix(config(), v) + (rel === '/' ? '' : rel) || '/',
    ...(fallbackLocale && { fallbackLocale }),
  });
add({ version: 'v2', locale: 'en' }, '/');
add({ version: 'v2', locale: 'en' }, '/guides/auth');
add({ version: 'v2', locale: 'en' }, '/guides/new');
add({ version: 'v2', locale: 'fr' }, '/');
add({ version: 'v2', locale: 'fr' }, '/guides/auth');
add({ version: 'v2', locale: 'fr' }, '/guides/new', 'en');
add({ version: 'v1', locale: 'en' }, '/');
add({ version: 'v1', locale: 'en' }, '/guides/auth');
const find: FindPage = (v, rel) => corpus.get(`${variantKey(v)}|${rel}`);

describe('switchTarget', () => {
  const home = (v: Variant) => variantPrefix(config(), v) || '/';
  it('keeps the reader on the same page when it exists', () => {
    expect(
      switchTarget(
        find,
        { rel: '/guides/auth' },
        { version: 'v1', locale: 'en' },
        '/v1',
      ),
    ).toEqual({
      path: '/v1/guides/auth',
      exact: true,
    });
  });

  it('falls back to the nearest parent, then the home page', () => {
    expect(
      switchTarget(
        find,
        { rel: '/guides/new' },
        { version: 'v1', locale: 'en' },
        '/v1',
      ),
    ).toEqual({
      path: '/v1',
      exact: false,
    });
    expect(
      switchTarget(
        find,
        { rel: '/nowhere/at/all' },
        { version: 'v1', locale: 'en' },
        '/v1',
      ),
    ).toEqual({
      path: '/v1',
      exact: false,
    });
    expect(
      switchTarget(
        find,
        { rel: '/x' },
        { version: 'next', locale: 'en' },
        '/next',
      ),
    ).toEqual({
      path: '/next',
      exact: false,
    });
  });

  it('does not count an untranslated stand-in as the same page', () => {
    expect(
      switchTarget(
        find,
        { rel: '/guides/new' },
        { version: 'v2', locale: 'fr' },
        '/fr',
      ),
    ).toEqual({
      path: '/fr',
      exact: false,
    });
    void home;
  });
});

describe('alternates', () => {
  it('lists only real translations, plus x-default', () => {
    const c = config();
    expect(alternates(c, find, { rel: '/guides/auth', version: 'v2' })).toEqual(
      [
        { hreflang: 'en', path: '/guides/auth' },
        { hreflang: 'x-default', path: '/guides/auth' },
        { hreflang: 'fr', path: '/fr/guides/auth' },
      ],
    );
    expect(alternates(c, find, { rel: '/guides/new', version: 'v2' })).toEqual(
      [],
    );
    expect(alternates(parseConfig({ name: 'X' }), find, { rel: '/' })).toEqual(
      [],
    );
  });
});

describe('versionBanner', () => {
  const c = config();
  const homeOf = (v: Variant) => variantPrefix(c, v) || '/';
  it('is absent on the latest version', () => {
    expect(
      versionBanner(
        c,
        find,
        { rel: '/guides/auth', version: 'v2', locale: 'en' },
        homeOf,
      ),
    ).toBeUndefined();
    expect(
      versionBanner(parseConfig({ name: 'X' }), find, { rel: '/' }, homeOf),
    ).toBeUndefined();
  });

  it('points an old version at the latest page', () => {
    expect(
      versionBanner(
        c,
        find,
        { rel: '/guides/auth', version: 'v1', locale: 'en' },
        homeOf,
      ),
    ).toMatchObject({
      kind: 'deprecated',
      latest: { path: '/guides/auth', exact: true },
    });
    expect(
      versionBanner(
        c,
        find,
        { rel: '/guides/auth', version: 'next', locale: 'en' },
        homeOf,
      )?.kind,
    ).toBe('unreleased');
  });
});

describe('buildVariantUi', () => {
  const c = config();
  const homeOf = (v: Variant) => variantPrefix(c, v) || '/';
  it('lists switch targets, marks the active ones and sets direction', () => {
    const ui = buildVariantUi(
      c,
      find,
      { rel: '/guides/auth', locale: 'fr', version: 'v2' },
      homeOf,
    );
    expect(ui.lang).toBe('fr');
    expect(ui.dir).toBe('ltr');
    expect(ui.locales.find((l) => l.code === 'en')).toMatchObject({
      path: '/guides/auth',
      exact: true,
      active: false,
    });
    expect(ui.locales.find((l) => l.code === 'fr')).toMatchObject({
      active: true,
      path: '/fr/guides/auth',
    });
    // no Arabic page exists: the switcher goes to the nearest page that does
    expect(ui.locales.find((l) => l.code === 'ar')).toMatchObject({
      exact: false,
      path: '/ar',
    });
    expect(ui.versions.find((v) => v.name === 'v1')).toMatchObject({
      path: '/v1/fr',
      exact: false,
      status: 'deprecated',
    });
    expect(ui.banner).toBeUndefined();
    expect(ui.fallback).toBeUndefined();
  });

  it('is right to left for Arabic, and explains a stand-in page', () => {
    expect(
      buildVariantUi(c, find, { rel: '/', locale: 'ar', version: 'v2' }, homeOf)
        .dir,
    ).toBe('rtl');
    const ui = buildVariantUi(
      c,
      find,
      { rel: '/guides/new', locale: 'fr', version: 'v2', fallbackLocale: 'en' },
      homeOf,
    );
    expect(ui.fallback).toEqual({ language: 'Français', original: 'English' });
  });

  it('adds the banner on an old version', () => {
    const ui = buildVariantUi(
      c,
      find,
      { rel: '/guides/auth', locale: 'en', version: 'v1' },
      homeOf,
    );
    expect(ui.banner).toMatchObject({
      kind: 'deprecated',
      latest: { path: '/guides/auth' },
    });
  });

  it('works for a site with neither', () => {
    const ui = buildVariantUi(
      parseConfig({ name: 'X' }),
      find,
      { rel: '/' },
      () => '/',
    );
    expect(ui).toEqual({ dir: 'ltr', locales: [], versions: [] });
  });
});

describe('pathWithLocale', () => {
  const c = config();
  it('adds the language after the version, and keeps a trailing slash', () => {
    expect(pathWithLocale(c, '/guides/a', 'fr')).toBe('/fr/guides/a');
    expect(pathWithLocale(c, '/v1/guides/a', 'fr')).toBe('/v1/fr/guides/a');
    expect(pathWithLocale(c, '/', 'fr')).toBe('/fr');
    expect(pathWithLocale(c, '/guides/', 'fr')).toBe('/fr/guides/');
  });
  it('leaves an address that already names a language', () => {
    expect(pathWithLocale(c, '/fr/guides/a', 'ar')).toBeUndefined();
    expect(pathWithLocale(c, '/en/guides/a', 'fr')).toBeUndefined();
  });
  it('goes to the default language by dropping the prefix, and respects urlPrefix', () => {
    expect(pathWithLocale(c, '/guides/a', 'en')).toBe('/guides/a');
    expect(pathWithLocale(c, '/docs/guides/a', 'fr', '/docs')).toBe(
      '/docs/fr/guides/a',
    );
    expect(pathWithLocale(c, '/docs', 'fr', '/docs')).toBe('/docs/fr');
    expect(pathWithLocale(c, '/other/guides/a', 'fr', '/docs')).toBeUndefined();
  });
});
