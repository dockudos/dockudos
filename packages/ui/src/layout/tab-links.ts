import type { NavTab } from '@dockudos/core';

export interface TabLink {
  title: string;
  href: string;
  external: boolean;
  active: boolean;
}

export function tabLinks(
  tabs: readonly NavTab[],
  firstPage: (tab: NavTab) => string | undefined,
  active: NavTab | undefined,
): TabLink[] {
  return tabs.flatMap((tab) => {
    const href = tab.href ?? firstPage(tab);
    return href
      ? [
          {
            title: tab.title,
            href,
            external: !!tab.href,
            active: tab === active,
          },
        ]
      : [];
  });
}
