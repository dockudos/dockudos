'use client';

import type { TocEntry } from '@dockudos/core';
import { useEffect, useState } from 'react';
import { useMessages } from '../messages-context.tsx';

/** Id of the last heading that has scrolled past the top of the viewport, or the first one. */
export function useActiveHeading(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);

  useEffect(() => {
    if (ids.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // Prefer the topmost visible heading; if none is visible keep the previous one.
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      // The band just below the navbar, ignoring the lower 70% of the viewport.
      { rootMargin: '-80px 0px -70% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export function Toc({ entries }: { entries: readonly TocEntry[] }) {
  const t = useMessages();
  const ids = entries.map((e) => e.id);
  const active = useActiveHeading(ids);
  if (entries.length === 0) return null;
  return (
    <nav aria-labelledby="dk-toc-title">
      <h2 id="dk-toc-title" className="dk-toc-title">
        {t('onThisPage')}
      </h2>
      <ul className="m-0 list-none p-0">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              data-depth={e.depth}
              aria-current={e.id === active ? 'location' : undefined}
            >
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
