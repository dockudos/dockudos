import GithubSlugger from 'github-slugger';
import { FenceTracker } from './fence.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { type Navigation, findTab, flattenSidebar } from './navigation.ts';
import type { Page } from './page-tree.ts';
import type { SidebarItem } from './navigation.ts';

export interface Crumb {
  title: string;
  /** Absent for groups, which are labels rather than pages. */
  href?: string;
}

/** Trail from the tab to the page: `Tab > Group > Page`. Empty when the page is not in the navigation. */
export function breadcrumb(nav: Navigation, path: string): Crumb[] {
  for (const tab of nav.tabs) {
    const trail = trailIn(tab.sidebar, path);
    if (trail) return [{ title: tab.title }, ...trail];
  }
  return [];
}

function trailIn(
  items: readonly SidebarItem[],
  path: string,
): Crumb[] | undefined {
  for (const item of items) {
    if (item.type === 'page' && item.page.path === path) {
      return [{ title: item.page.title, href: item.page.path }];
    }
    if (item.type === 'group') {
      const inner = trailIn(item.items, path);
      if (inner) return [{ title: item.title }, ...inner];
    }
  }
  return undefined;
}

/** Neighbouring pages inside the same tab. */
export function prevNext(
  nav: Navigation,
  path: string,
): { prev?: Page; next?: Page } {
  const tab = findTab(nav, path);
  if (!tab) return {};
  const pages = flattenSidebar(tab.sidebar);
  const i = pages.findIndex((p) => p.path === path);
  return { prev: pages[i - 1], next: pages[i + 1] };
}

export interface TocEntry {
  id: string;
  text: string;
  depth: number;
}

/**
 * Headings of a markdown/MDX source, with the same ids `rehype-slug` produces
 * (both use github-slugger). Code fences are skipped; h1 is the page title and
 * is left out by default.
 */
export function extractToc(
  source: string,
  { minDepth = 2, maxDepth = 4 }: { minDepth?: number; maxDepth?: number } = {},
): TocEntry[] {
  const slugger = new GithubSlugger();
  const out: TocEntry[] = [];
  const fence = new FenceTracker();
  for (const line of parseFrontmatter(source).body.split(/\r?\n/)) {
    if (fence.inCode(line)) continue;
    const m = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!m) continue;
    const depth = m[1]?.length ?? 0;
    const text = plainText(m[2] ?? '');
    const id = slugger.slug(text); // consume a slug for every heading so duplicates number like rehype-slug
    if (depth >= minDepth && depth <= maxDepth) out.push({ id, text, depth });
  }
  return out;
}

/** Strip inline markdown/JSX to the visible text of a heading. */
function plainText(heading: string): string {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\*\*|\*|~~|`/g, '')
    .replace(/(?<!\w)(__?)(\S(?:.*?\S)?)\1(?!\w)/g, '$2')
    .trim();
}
