'use client';

import type { SidebarItem } from '@dockudos/core';
import { ChevronRight } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import { renderIcon } from '../components/render-icon.tsx';
import { useLink } from '../provider.tsx';

/** Short labels for the method in front of an endpoint in the sidebar. */
const METHOD_BADGE: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DEL',
  options: 'OPT',
  head: 'HEAD',
  trace: 'TRACE',
};

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
  numbered = false,
}: {
  items: readonly SidebarItem[];
  path: string;
  depth: number;
  /** Number the pages: the steps of a tutorial. */
  numbered?: boolean;
}) {
  const Link = useLink();
  let step = 0;
  return (
    <ul className="dk-nav-list">
      {items.map((item, i) => {
        if (item.type === 'page') {
          step += 1;
          const active = item.page.path === path;
          return (
            <li key={item.page.path}>
              <Link
                href={item.page.path}
                className="dk-nav-link"
                aria-current={active ? 'page' : undefined}
              >
                {numbered && (
                  <span className="dk-nav-step" aria-hidden="true">
                    {step}
                  </span>
                )}
                {!numbered && item.page.icon && (
                  <span className="dk-nav-icon">
                    {renderIcon(item.page.icon, 15)}
                  </span>
                )}
                {item.page.api?.method && (
                  <span
                    className="dk-api-method"
                    data-method={item.page.api.method}
                  >
                    {METHOD_BADGE[item.page.api.method] ??
                      item.page.api.method.toUpperCase()}
                  </span>
                )}
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
              <Items
                items={item.items}
                path={path}
                depth={depth + 1}
                numbered={item.tutorial}
              />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** The sidebar tree of the active tab. `path` marks the current page. */
/**
 * Keep the current page in view when a long sidebar opens scrolled to the top. Only the sidebar
 * scrolls; the page itself stays where it is.
 */
function useScrollActiveIntoView(
  ref: RefObject<HTMLElement | null>,
  path: string,
) {
  useEffect(() => {
    const active = ref.current?.querySelector('[aria-current="page"]');
    const panel = ref.current?.closest<HTMLElement>('.dk-sidebar');
    if (!active || !panel) return;
    const a = active.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    if (a.top < p.top || a.bottom > p.bottom) {
      panel.scrollTop += a.top - p.top - p.height / 3;
    }
  }, [ref, path]);
}

export function Sidebar({
  items,
  path,
}: {
  items: readonly SidebarItem[];
  path: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useScrollActiveIntoView(ref, path);
  return (
    <nav ref={ref} aria-label="Documentation">
      <Items items={items} path={path} depth={0} />
    </nav>
  );
}
