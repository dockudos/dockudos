'use client';

import { md, type ToMarkdown } from '@dockudos/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface ChangelogProps {
  /** The `<Update>` entries, newest first. */
  children: ReactNode;
}

/**
 * A changelog: `<Update>` entries with a row of tag buttons to show only one kind of change. The tags are the ones
 * the entries carry. Without JavaScript every entry shows.
 */
export function Changelog({ children }: ChangelogProps) {
  const root = useRef<HTMLDivElement>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const found = new Set<string>();
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-update-tags]') ?? [])
      for (const tag of (el.dataset['updateTags'] ?? '').split('\n')) if (tag) found.add(tag);
    setTags([...found]);
  }, [children]);

  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('.dk-update') ?? []) {
      const own = (el.dataset['updateTags'] ?? '').split('\n');
      el.hidden = !!active && !own.includes(active);
    }
  }, [active, children, tags]);

  return (
    <div className="dk-changelog" ref={root}>
      {tags.length > 0 && (
        <div className="dk-changelog-filter" role="group" aria-label="Filter by tag" data-print="hide">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={active === tag}
              onClick={() => setActive(active === tag ? undefined : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

Changelog.toMarkdown = md.container satisfies ToMarkdown<never>;
