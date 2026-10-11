'use client';

import type { VariantUi } from '@dockudos/core';
import { useMessages } from '../messages-context.tsx';
import { useLink, useNavigate } from '../provider.tsx';

/** Remembered so a first visit can be sent to the language the reader chose last time (`i18n.detect`). */
export const LOCALE_COOKIE = 'dockudos-locale';

function Select<T extends { path: string; active: boolean; label: string }>({
  label,
  items,
  keyOf,
  onChoose,
  className,
}: {
  label: string;
  items: readonly T[];
  keyOf: (item: T) => string;
  onChoose: (item: T) => void;
  className: string;
}) {
  if (items.length < 2) return null;
  const active = items.find((i) => i.active);
  return (
    <label className={className}>
      <span className="sr-only">{label}</span>
      <select
        value={active ? keyOf(active) : ''}
        onChange={(e) => {
          const chosen = items.find((i) => keyOf(i) === e.target.value);
          if (chosen) onChoose(chosen);
        }}
      >
        {items.map((i) => (
          <option key={keyOf(i)} value={keyOf(i)}>
            {i.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Switches the language, staying on the same page when it is translated. */
export function LanguageSwitcher({
  locales,
}: {
  locales: VariantUi['locales'];
}) {
  const t = useMessages();
  const navigate = useNavigate();
  return (
    <Select
      className="dk-switcher dk-language-switcher"
      label={t('language')}
      items={locales}
      keyOf={(l) => l.code}
      onChoose={(l) => {
        try {
          document.cookie = `${LOCALE_COOKIE}=${l.code}; Path=/; Max-Age=31536000; SameSite=Lax`;
        } catch {
          /* cookies blocked: the choice just is not remembered */
        }
        navigate(l.path);
      }}
    />
  );
}

/** Switches the version, staying on the same page when it exists there. */
export function VersionSwitcher({
  versions,
}: {
  versions: VariantUi['versions'];
}) {
  const t = useMessages();
  const navigate = useNavigate();
  return (
    <Select
      className="dk-switcher dk-version-switcher"
      label={t('version')}
      items={versions}
      keyOf={(v) => v.name}
      onChoose={(v) => navigate(v.path)}
    />
  );
}

/** The notice above a page of an old, deprecated or unreleased version. */
export function VersionBanner({
  banner,
}: {
  banner: NonNullable<VariantUi['banner']>;
}) {
  const t = useMessages();
  const Link = useLink();
  const text = {
    outdated: t('versionOutdated', { version: banner.label }),
    deprecated: t('versionDeprecated', { version: banner.label }),
    unreleased: t('versionUnreleased', { version: banner.label }),
  }[banner.kind];
  return (
    <div className="dk-version-banner" data-kind={banner.kind} role="note">
      <span>{text}</span>{' '}
      <Link href={banner.latest.path}>
        {banner.latest.exact ? t('goToLatestPage') : t('goToLatest')}
      </Link>
    </div>
  );
}

/** The notice on a page shown in another language because it is not translated. */
export function FallbackNotice({
  fallback,
}: {
  fallback: NonNullable<VariantUi['fallback']>;
}) {
  const t = useMessages();
  return (
    <div className="dk-fallback-notice" role="note">
      {t('fallbackNotice', fallback)}
    </div>
  );
}
