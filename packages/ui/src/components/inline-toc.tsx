'use client';

import type { TocEntry } from '@dockudos/core';
import { usePageData } from '../docs-context.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

/** The page's own table of contents, inline. Takes `items` explicitly, else uses the current page's. */
export function InlineToc({ items }: { items?: readonly TocEntry[] }) {
  const page = usePageData();
  const entries = items ?? page.toc;
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Contents"
      className="not-prose my-5 rounded-lg border bg-card p-4 text-sm"
    >
      <ul className="m-0 list-none space-y-1 p-0">
        {entries.map((e) => (
          <li key={e.id} style={{ paddingLeft: `${(e.depth - 2) * 1}rem` }}>
            <a
              href={`#${e.id}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

InlineToc.toMarkdown = ((_props, _children, { headings }) =>
  md.block(
    headings
      .filter((h) => h.depth >= 2)
      .map((h) => `${'  '.repeat(h.depth - 2)}- ${md.link(h.text, `#${h.id}`)}`)
      .join('\n'),
  )) satisfies ToMarkdown;
