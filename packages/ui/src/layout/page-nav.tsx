'use client';

import type { Crumb } from '@dockudos/core';
import { useLink } from '../provider.tsx';
import { useMessages } from '../messages-context.tsx';

export function Breadcrumb({ crumbs }: { crumbs: readonly Crumb[] }) {
  const Link = useLink();
  const t = useMessages();
  if (crumbs.length < 2) return null;
  return (
    <nav className="dk-breadcrumb" aria-label={t('breadcrumb')}>
      <ol>
        {crumbs.map((c, i) => (
          <li key={`${c.title}-${i}`}>
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href}>{c.title}</Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                {c.title}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

interface Neighbour {
  path: string;
  title: string;
}

export function PrevNext({
  prev,
  next,
}: {
  prev?: Neighbour;
  next?: Neighbour;
}) {
  const Link = useLink();
  const t = useMessages();
  if (!prev && !next) return null;
  return (
    <nav className="dk-pager" aria-label={t('pager')}>
      {prev && (
        <Link href={prev.path} rel="prev" className="dk-prev">
          <small>{t('previous')}</small>
          {prev.title}
        </Link>
      )}
      {next && (
        <Link href={next.path} rel="next" className="dk-next">
          <small>{t('next')}</small>
          {next.title}
        </Link>
      )}
    </nav>
  );
}
