import type { DocsConfig } from './config.ts';

/** One slice of the docs a reader sees: a version, a language, or both. Absent means "the site has none". */
export interface Variant {
  locale?: string;
  version?: string;
}

export interface LocaleInfo {
  code: string;
  label: string;
  rtl: boolean;
  isDefault: boolean;
}

export interface VersionInfo {
  name: string;
  label: string;
  /** Folder below `docs/`. */
  dir: string;
  status: 'stable' | 'deprecated' | 'unreleased';
  isDefault: boolean;
  /** This version's own sidebar, when it has one. */
  navigation?: DocsConfig['navigation'];
}

type VariantConfig = Pick<DocsConfig, 'versions' | 'i18n'>;

const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb']);

/** Is this language written right to left? */
export const isRtl = (code: string): boolean =>
  RTL.has(code.toLowerCase().split('-')[0] as string);

/** A language's name in itself, from the platform's data; the code when it has none. */
export function localeLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    /* an unknown tag */
  }
  return code;
}

export function localeInfos(config: VariantConfig): LocaleInfo[] {
  const i18n = config.i18n;
  if (!i18n) return [];
  const infos = i18n.locales.map((l): LocaleInfo => {
    const code = typeof l === 'string' ? l : l.code;
    const options: { label?: string; rtl?: boolean } =
      typeof l === 'string' ? {} : l;
    return {
      code,
      label: options.label ?? localeLabel(code),
      rtl: options.rtl ?? isRtl(code),
      isDefault: code === i18n.default,
    };
  });
  // The default first, the rest in the order listed.
  return [
    ...infos.filter((l) => l.isDefault),
    ...infos.filter((l) => !l.isDefault),
  ];
}

export function versionInfos(config: VariantConfig): VersionInfo[] {
  const versions = config.versions;
  if (!versions) return [];
  return versions.list.map(
    (v): VersionInfo => ({
      name: v.name,
      label: v.label ?? v.name,
      dir: v.dir ?? v.name,
      status: v.status,
      isDefault: v.name === versions.default,
      ...(v.navigation && { navigation: v.navigation }),
    }),
  );
}

export const defaultVariant = (config: VariantConfig): Variant => ({
  ...(config.i18n && { locale: config.i18n.default }),
  ...(config.versions && { version: config.versions.default }),
});

/** Every version and language combination, the default first. */
export function allVariants(config: VariantConfig): Variant[] {
  const locales = localeInfos(config);
  const versions = [...versionInfos(config)].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault),
  );
  if (!locales.length && !versions.length) return [{}];
  const out: Variant[] = [];
  for (const version of versions.length ? versions : [undefined])
    for (const locale of locales.length ? locales : [undefined])
      out.push({
        ...(locale && { locale: locale.code }),
        ...(version && { version: version.name }),
      });
  return out;
}

/** A stable id for a variant: `v1/fr`, `v1`, `fr`, or `` for a site with neither. */
export const variantKey = (v: Variant): string =>
  [v.version, v.locale].filter(Boolean).join('/');

/**
 * The URL prefix of a variant, below `urlPrefix`: `/v1/fr`. The default version and the default language
 * add nothing, so a site's main pages keep short addresses.
 */
export function variantPrefix(config: VariantConfig, v: Variant): string {
  const parts: string[] = [];
  if (config.versions && v.version && v.version !== config.versions.default)
    parts.push(v.version);
  if (config.i18n && v.locale && v.locale !== config.i18n.default)
    parts.push(v.locale);
  return parts.length ? `/${parts.join('/')}` : '';
}

/** The folder of a variant's files below `docs/`: `v1/fr`. Empty for a site with neither versions nor languages. */
export function variantDir(config: VariantConfig, v: Variant): string {
  const parts: string[] = [];
  if (config.versions) {
    const version = versionInfos(config).find(
      (x) => x.name === (v.version ?? config.versions?.default),
    );
    if (version) parts.push(version.dir);
  }
  if (config.i18n) parts.push(v.locale ?? config.i18n.default);
  return parts.join('/');
}

export interface ParsedPath {
  variant: Variant;
  /** The page's segments with the variant's prefix removed. */
  rest: string[];
  /**
   * The address spelled out a default (`/en/…`, or the default version's name). It is the same page as the short
   * address, so callers send the reader there.
   */
  redundant: boolean;
  /** The address names the language / the version, rather than leaving it to the default. */
  explicitLocale: boolean;
  explicitVersion: boolean;
}

/** Split URL segments (below `urlPrefix`) into the variant they select and the page within it. */
export function parseVariantPath(
  config: VariantConfig,
  segments: readonly string[],
): ParsedPath {
  const variant = defaultVariant(config);
  let i = 0;
  let redundant = false;
  let explicitVersion = false;
  let explicitLocale = false;
  const versions = config.versions;
  if (
    versions &&
    segments[i] &&
    versions.list.some((v) => v.name === segments[i])
  ) {
    variant.version = segments[i];
    explicitVersion = true;
    if (segments[i] === versions.default) redundant = true;
    i++;
  }
  const locales = config.i18n && localeInfos(config);
  const code = locales?.find((l) => l.code === segments[i])?.code;
  if (config.i18n && code) {
    variant.locale = code;
    explicitLocale = true;
    if (code === config.i18n.default) redundant = true;
    i++;
  }
  return {
    variant,
    rest: segments.slice(i),
    redundant,
    explicitVersion,
    explicitLocale,
  };
}

/**
 * The same address in another language, keeping the version: `/v1/guides/a` becomes `/v1/fr/guides/a`. Returns
 * `undefined` when the address is not below `urlPrefix`, or already names a language (the reader chose it).
 */
export function pathWithLocale(
  config: VariantConfig,
  pathname: string,
  locale: string,
  urlPrefix = '',
): string | undefined {
  const segments = pathname.split('/').filter(Boolean);
  const prefix = urlPrefix.split('/').filter(Boolean);
  if (!prefix.every((p, i) => segments[i] === p)) return undefined;
  const parsed = parseVariantPath(config, segments.slice(prefix.length));
  if (parsed.explicitLocale) return undefined;
  const next = variantPrefix(config, { ...parsed.variant, locale });
  const out = [...prefix, ...next.split('/').filter(Boolean), ...parsed.rest];
  return (
    '/' +
    out.join('/') +
    (pathname.length > 1 && pathname.endsWith('/') ? '/' : '')
  );
}

/**
 * Pick the site language that best matches an `Accept-Language` header: an exact tag first, then the same
 * base language (`fr-CA` gets `fr`), in the order of the reader's preference. Falls back to `fallback`.
 */
export function negotiateLocale(
  header: string | null | undefined,
  codes: readonly string[],
  fallback: string,
): string {
  const wanted = (header ?? '')
    .split(',')
    .map((part, order) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number.parseFloat(
        params.map((p) => /^\s*q\s*=\s*([\d.]+)/.exec(p)?.[1]).find(Boolean) ??
          '1',
      );
      return {
        tag: tag.trim().toLowerCase(),
        q: Number.isFinite(q) ? q : 0,
        order,
      };
    })
    .filter((w) => w.tag && w.tag !== '*' && w.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  const lower = codes.map((c) => c.toLowerCase());
  for (const { tag } of wanted) {
    const exact = lower.indexOf(tag);
    if (exact !== -1) return codes[exact] as string;
    const base = tag.split('-')[0];
    const same = lower.findIndex((c) => c === base || c.split('-')[0] === base);
    if (same !== -1) return codes[same] as string;
  }
  return fallback;
}

/** What the version and language switchers need to know about a page that has been located. */
export interface Located {
  path: string;
  /** The page's address inside its variant, without the variant's prefix: `/guides/auth`. */
  rel: string;
  /** Set when the page is a stand-in for an untranslated one: the language its text is in. */
  fallbackLocale?: string;
}

export type FindPage = (variant: Variant, rel: string) => Located | undefined;

export interface SwitchTarget {
  path: string;
  /** The same page exists in the target variant. False when the reader lands on a parent or the home page. */
  exact: boolean;
}

/**
 * Where the version or language switcher sends a reader: the same page in the target variant when it exists
 * (and is translated, for a language switch), else the nearest parent that does, else the home page.
 */
export function switchTarget(
  find: FindPage,
  from: { rel: string },
  to: Variant,
  home: string,
): SwitchTarget {
  const segments = from.rel.split('/').filter(Boolean);
  for (let n = segments.length; n >= 0; n--) {
    const rel = '/' + segments.slice(0, n).join('/');
    const found = find(to, rel);
    if (found && !found.fallbackLocale)
      return { path: found.path, exact: n === segments.length };
  }
  return { path: home, exact: false };
}

export interface Alternate {
  hreflang: string;
  path: string;
}

/**
 * `hreflang` alternates for a page: one per language in which it is actually translated (stand-ins do not
 * count), and `x-default` for the default language.
 */
export function alternates(
  config: VariantConfig,
  find: FindPage,
  page: { rel: string; version?: string },
): Alternate[] {
  const locales = localeInfos(config);
  if (locales.length < 2) return [];
  const out: Alternate[] = [];
  for (const locale of locales) {
    const found = find(
      { locale: locale.code, version: page.version },
      page.rel,
    );
    if (!found || found.fallbackLocale) continue;
    out.push({ hreflang: locale.code, path: found.path });
    if (locale.isDefault) out.push({ hreflang: 'x-default', path: found.path });
  }
  return out.filter((a) => a.hreflang !== 'x-default').length > 1 ? out : [];
}

export interface VersionBanner {
  kind: 'outdated' | 'deprecated' | 'unreleased';
  /** Where the latest version's equivalent page is, for "go to the latest". */
  latest: SwitchTarget;
  version: string;
  label: string;
}

/** The notice for a page of a version that is not the latest, or `undefined` for the latest. */
export function versionBanner(
  config: VariantConfig,
  find: FindPage,
  page: { rel: string; locale?: string; version?: string },
  homeOf: (variant: Variant) => string,
): VersionBanner | undefined {
  const versions = versionInfos(config);
  const current = versions.find((v) => v.name === page.version);
  if (!current || current.isDefault) return undefined;
  const latest = versions.find((v) => v.isDefault) as VersionInfo;
  const target = { locale: page.locale, version: latest.name };
  return {
    kind:
      current.status === 'unreleased'
        ? 'unreleased'
        : current.status === 'deprecated'
          ? 'deprecated'
          : 'outdated',
    latest: switchTarget(find, page, target, homeOf(target)),
    version: current.name,
    label: current.label,
  };
}

/** Everything the page frame needs to show version and language controls and notices for one page. */
export interface VariantUi {
  /** The page's language, for `lang`. */
  lang?: string;
  /** The page's version. */
  version?: string;
  dir: 'ltr' | 'rtl';
  locales: {
    code: string;
    label: string;
    path: string;
    exact: boolean;
    active: boolean;
  }[];
  versions: {
    name: string;
    label: string;
    path: string;
    exact: boolean;
    active: boolean;
    status: VersionInfo['status'];
  }[];
  banner?: VersionBanner;
  /** Set on an untranslated page: the names of the page's language and of the language its text is in. */
  fallback?: { language: string; original: string };
}

/**
 * The controls for a page: a language switcher and a version switcher whose targets are the same page in each
 * variant (or the nearest page there is), the notice for old or unreleased versions, and the notice for a page
 * that has no translation.
 */
export function buildVariantUi(
  config: VariantConfig,
  find: FindPage,
  page: {
    rel: string;
    locale?: string;
    version?: string;
    fallbackLocale?: string;
  },
  homeOf: (variant: Variant) => string,
): VariantUi {
  const locales = localeInfos(config);
  const versions = versionInfos(config);
  const current = locales.find((l) => l.code === page.locale);
  const target = (v: Variant) => switchTarget(find, page, v, homeOf(v));
  const original = page.fallbackLocale
    ? locales.find((l) => l.code === page.fallbackLocale)
    : undefined;
  return {
    ...(page.locale && { lang: page.locale }),
    ...(page.version && { version: page.version }),
    dir: current?.rtl ? 'rtl' : 'ltr',
    locales: locales.map((l) => ({
      code: l.code,
      label: l.label,
      active: l.code === page.locale,
      ...target({ locale: l.code, version: page.version }),
    })),
    versions: versions.map((v) => ({
      name: v.name,
      label: v.label,
      status: v.status,
      active: v.name === page.version,
      ...target({ locale: page.locale, version: v.name }),
    })),
    ...(versionBanner(config, find, page, homeOf) && {
      banner: versionBanner(config, find, page, homeOf),
    }),
    ...(current &&
      original && {
        fallback: { language: current.label, original: original.label },
      }),
  };
}
