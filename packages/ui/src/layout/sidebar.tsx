'use client';

import type { SidebarItem } from '@dockudos/core';
import { ChevronRight } from 'lucide-react';
import { useLink } from '../provider.tsx';

const hasActive = (items: readonly SidebarItem[], path: string): boolean =>
  items.some((i) =>
    i.type === 'page'
      ? i.page.path === path
      : i.type === 'group' && hasActive(i.items, path),
  );

function Items({
  items,
  path,
  depth,
}: {
  items: readonly SidebarItem[];
  path: string;
  depth: number;
}) {
  const Link = useLink();
  return (
    <ul className="dk-nav-list">
      {items.map((item, i) => {
        if (item.type === 'page') {
          const active = item.page.path === path;
          return (
            <li key={item.page.path}>
              <Link
                href={item.page.path}
                className="dk-nav-link"
                aria-current={active ? 'page' : undefined}
              >
                {item.page.sidebarTitle ?? item.page.title}
              </Link>
            </li>
          );
        }
        if (item.type === 'link') {
          return (
            <li key={`${item.href}-${i}`}>
              <a
                className="dk-nav-link"
                href={item.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {item.title}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          );
        }
        return (
          <li key={`${item.title}-${i}`}>
            <details
              className="dk-nav-collapsible"
              open={depth === 0 || hasActive(item.items, path)}
            >
              <summary className={depth === 0 ? 'dk-nav-title' : 'dk-nav-link'}>
                {item.title}
                <ChevronRight
                  className="dk-chevron size-3.5"
                  aria-hidden="true"
                />
              </summary>
              <Items items={item.items} path={path} depth={depth + 1} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** The sidebar tree of the active tab. `path` marks the current page. */
export function Sidebar({
  items,
  path,
}: {
  items: readonly SidebarItem[];
  path: string;
}) {
  return (
    <nav aria-label="Documentation">
      <Items items={items} path={path} depth={0} />
    </nav>
  );
}
