import type { Navigation, SidebarItem } from '@dockudos/core';
import type { PaletteEntry } from './command-palette.tsx';

/** The pages of the navigation as palette entries, in reading order, each tagged with its section. */
export function paletteEntries(nav: Navigation): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const seen = new Set<string>();
  const walk = (items: readonly SidebarItem[], group: string | undefined) => {
    for (const item of items) {
      if (item.type === 'page') {
        if (seen.has(item.page.path)) continue;
        seen.add(item.page.path);
        out.push({
          title: item.page.sidebarTitle ?? item.page.title,
          path: item.page.path,
          group,
          description: item.page.description,
          icon: item.page.icon,
        });
      } else if (item.type === 'group') {
        walk(item.items, item.title);
      }
    }
  };
  for (const tab of nav.tabs) if (!tab.href) walk(tab.sidebar, tab.title);
  for (const page of nav.unlisted) {
    if (seen.has(page.path)) continue;
    seen.add(page.path);
    out.push({
      title: page.title,
      path: page.path,
      description: page.description,
      icon: page.icon,
    });
  }
  return out;
}
