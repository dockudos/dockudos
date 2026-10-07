import type { DocsConfig, NavItem } from './config.ts';
import type { Folder, Page, PageTree } from './page-tree.ts';
import { titleFromSlug } from './page-tree.ts';

export type SidebarItem =
  | { type: 'page'; page: Page }
  | { type: 'link'; title: string; href: string }
  | { type: 'group'; title: string; items: SidebarItem[] };

export interface NavTab {
  title: string;
  /** Set for external-link tabs, which have no sidebar. */
  href?: string;
  sidebar: SidebarItem[];
}

export interface Navigation {
  tabs: NavTab[];
  /** Visible pages that no navigation entry references. They stay routable. */
  unlisted: Page[];
}

export class NavigationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid navigation in docs.json:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'NavigationError';
    this.issues = issues;
  }
}

const DOC_EXT = /\.mdx?$/;

/**
 * Combine the config's navigation with discovered pages. With no configured
 * navigation the sidebar is derived from the folder structure.
 */
export function buildNavigation(
  config: Pick<DocsConfig, 'navigation'>,
  tree: PageTree,
): Navigation {
  if (config.navigation.length === 0) {
    const tabs: NavTab[] = [{ title: 'Docs', sidebar: folderSidebar(tree) }];
    return { tabs, unlisted: [] };
  }

  const byId = new Map<string, Page>();
  for (const page of tree.pages) {
    byId.set(page.file.replace(DOC_EXT, ''), page);
    // `guides` also resolves to `guides/index`.
    if (page.file.replace(DOC_EXT, '').endsWith('/index')) {
      byId.set(page.file.replace(DOC_EXT, '').replace(/\/index$/, ''), page);
    }
  }

  const issues: string[] = [];
  const used = new Set<Page>();

  const resolve = (item: NavItem, where: string): SidebarItem | undefined => {
    if (typeof item === 'string') {
      const page = byId.get(item.replace(DOC_EXT, ''));
      if (!page) {
        issues.push(`${where}: page "${item}" not found in the docs folder`);
        return undefined;
      }
      used.add(page);
      return { type: 'page', page };
    }
    if ('href' in item) return { type: 'link', ...item };
    return {
      type: 'group',
      title: item.group,
      items: resolveAll(item.pages, `${where} > ${item.group}`),
    };
  };
  const resolveAll = (items: NavItem[], where: string): SidebarItem[] =>
    items.flatMap((item) => resolve(item, where) ?? []);

  const tabs = config.navigation.map((tab): NavTab => {
    if ('href' in tab) return { title: tab.tab, href: tab.href, sidebar: [] };
    return {
      title: tab.tab,
      sidebar: tab.groups.map((g) => ({
        type: 'group' as const,
        title: g.group,
        items: resolveAll(g.pages, `${tab.tab} > ${g.group}`),
      })),
    };
  });

  if (issues.length) throw new NavigationError(issues);
  return {
    tabs,
    unlisted: tree.pages.filter((p) => !p.hidden && !used.has(p)),
  };
}

function folderSidebar(tree: PageTree): SidebarItem[] {
  const toItems = (index: Page | undefined, children: Folder['children']) => {
    const items: SidebarItem[] = [];
    if (index && !index.hidden) items.push({ type: 'page', page: index });
    for (const child of children) {
      if (child.type === 'page') {
        if (!child.hidden) items.push({ type: 'page', page: child });
      } else {
        const inner = toItems(child.index, child.children);
        if (inner.length) {
          items.push({
            type: 'group',
            title: titleFromSlug(child.name),
            items: inner,
          });
        }
      }
    }
    return items;
  };
  return toItems(tree.index, tree.children);
}

/** Every page of a sidebar in reading order. */
export function flattenSidebar(sidebar: readonly SidebarItem[]): Page[] {
  return sidebar.flatMap((item) => {
    if (item.type === 'page') return [item.page];
    if (item.type === 'group') return flattenSidebar(item.items);
    return [];
  });
}

/** The tab whose sidebar contains `path`, if any. */
export function findTab(nav: Navigation, path: string): NavTab | undefined {
  return nav.tabs.find((t) =>
    flattenSidebar(t.sidebar).some((p) => p.path === path),
  );
}
