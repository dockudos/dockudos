import type { DocsConfig, NavItem } from './config.ts';
import type { Folder, Page, PageTree } from './page-tree.ts';
import { titleFromSlug } from './page-tree.ts';

export type SidebarItem =
  | { type: 'page'; page: Page }
  | { type: 'link'; title: string; href: string }
  | {
      type: 'group';
      title: string;
      /** The group is a tutorial: its pages are steps. */
      tutorial?: boolean;
      items: SidebarItem[];
    };

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
  {
    lenient = false,
  }: {
    /**
     * Skip entries whose page does not exist instead of failing, and drop groups left empty. For a version or
     * language that has fewer pages than the one `docs.json` was written for.
     */
    lenient?: boolean;
  } = {},
): Navigation {
  if (config.navigation.length === 0) {
    const tabs: NavTab[] = [{ title: 'Docs', sidebar: folderSidebar(tree) }];
    return { tabs, unlisted: [] };
  }

  const byId = new Map<string, Page>();
  for (const page of tree.pages) {
    const id = page.contentFile.replace(DOC_EXT, '');
    byId.set(id, page);
    // `guides` also resolves to `guides/index`.
    if (id.endsWith('/index')) byId.set(id.replace(/\/index$/, ''), page);
  }

  const issues: string[] = [];
  const used = new Set<Page>();

  const resolve = (
    item: NavItem,
    where: string,
  ): SidebarItem | SidebarItem[] | undefined => {
    if (typeof item === 'string') {
      const page = byId.get(item.replace(DOC_EXT, ''));
      if (!page) {
        if (!lenient)
          issues.push(`${where}: page "${item}" not found in the docs folder`);
        return undefined;
      }
      used.add(page);
      return { type: 'page', page };
    }
    if ('href' in item) return { type: 'link', ...item };
    if ('openapi' in item || 'reference' in item) {
      const name = 'openapi' in item ? item.openapi : item.reference;
      const items = sourceSidebar(tree, name);
      if (!items.length && !lenient) {
        issues.push(
          `${where}: no pages were generated for "${name}". Run \`dockudos generate\` and check that the source is in docs.json`,
        );
      }
      for (const page of flattenSidebar(items)) used.add(page);
      return items;
    }
    return {
      type: 'group',
      title: item.group,
      ...(item.tutorial && { tutorial: true }),
      items: resolveAll(item.pages, `${where} > ${item.group}`),
    };
  };
  const resolveAll = (items: NavItem[], where: string): SidebarItem[] =>
    items.flatMap((item) => resolve(item, where) ?? []);

  const tabs = config.navigation.map((tab): NavTab => {
    if ('href' in tab) return { title: tab.tab, href: tab.href, sidebar: [] };
    return {
      title: tab.tab,
      sidebar: tab.groups
        .map((g) => ({
          type: 'group' as const,
          title: g.group,
          ...(g.tutorial && { tutorial: true }),
          items: resolveAll(g.pages, `${tab.tab} > ${g.group}`),
        }))
        .filter((g) => !lenient || g.items.length > 0),
    };
  });

  if (issues.length) throw new NavigationError(issues);
  return {
    tabs,
    unlisted: tree.pages.filter((p) => !p.hidden && !used.has(p)),
  };
}

/**
 * The sidebar of one generated source: the overview, then a group for each tag (or path segment, or kind of type)
 * in the order of the source.
 */
export function sourceSidebar(tree: PageTree, source: string): SidebarItem[] {
  const pages = tree.pages
    .filter((p) => p.api?.source === source && !p.hidden)
    .sort((a, b) => (a.api?.order ?? 0) - (b.api?.order ?? 0));
  const items: SidebarItem[] = pages
    .filter((p) => !p.api?.group)
    .map((page) => ({ type: 'page', page }));
  const groups = new Map<string, Extract<SidebarItem, { type: 'group' }>>();
  for (const page of pages) {
    const name = page.api?.group;
    if (!name) continue;
    let group = groups.get(name);
    if (!group) {
      group = { type: 'group', title: name, items: [] };
      groups.set(name, group);
      items.push(group);
    }
    group.items.push({ type: 'page', page });
  }
  return items;
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
            // A folder of generated pages is titled like its tag, not like its slug.
            title:
              child.children.find(
                (c): c is Page => c.type === 'page' && !!c.api?.group,
              )?.api?.group ?? titleFromSlug(child.name),
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

export interface TutorialPosition {
  /** The tutorial group's title. */
  title: string;
  /** 1-based number of the current step. */
  step: number;
  /** Every step, in order. */
  steps: Page[];
}

/** Where a page sits in a tutorial group (`tutorial: true` in docs.json), if it is in one. */
export function tutorialOf(
  nav: Navigation,
  path: string,
): TutorialPosition | undefined {
  const search = (
    items: readonly SidebarItem[],
  ): TutorialPosition | undefined => {
    for (const item of items) {
      if (item.type !== 'group') continue;
      if (item.tutorial) {
        const steps = flattenSidebar(item.items);
        const i = steps.findIndex((p) => p.path === path);
        if (i !== -1) return { title: item.title, step: i + 1, steps };
      }
      const inner = search(item.items);
      if (inner) return inner;
    }
    return undefined;
  };
  for (const tab of nav.tabs) {
    const found = search(tab.sidebar);
    if (found) return found;
  }
  return undefined;
}

/**
 * The sidebar without the pages `hide` names, and without the groups that leave empty. For readers who may not open
 * those pages: a link to a private page would tell them it exists and what it is called.
 */
export function pruneNavigation(
  nav: Navigation,
  hide: (page: Page) => boolean,
): Navigation {
  const prune = (items: readonly SidebarItem[]): SidebarItem[] =>
    items.flatMap((item): SidebarItem[] => {
      if (item.type === 'link') return [item];
      if (item.type === 'page') return hide(item.page) ? [] : [item];
      const inner = prune(item.items);
      return inner.length ? [{ ...item, items: inner }] : [];
    });
  return {
    tabs: nav.tabs.map((tab) => ({ ...tab, sidebar: prune(tab.sidebar) })),
    unlisted: nav.unlisted.filter((p) => !hide(p)),
  };
}
