'use client';

import type { Crumb } from '@dockudos/core';
import { useLink } from '../provider.tsx';

export function Breadcrumb({ crumbs }: { crumbs: readonly Crumb[] }) {
  const Link = useLink();
  if (crumbs.length < 2) return null;
  return (
    <nav className="dk-breadcrumb" aria-label="Breadcrumb">
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
  if (!prev && !next) return null;
  return (
    <nav className="dk-pager" aria-label="Previous and next pages">
      {prev && (
        <Link href={prev.path} rel="prev" className="dk-prev">
          <small>Previous</small>
          {prev.title}
        </Link>
      )}
      {next && (
        <Link href={next.path} rel="next" className="dk-next">
          <small>Next</small>
          {next.title}
        </Link>
      )}
    </nav>
  );
}
