import { isIndexable } from './content-index.ts';
import type { DocsConfig } from './config.ts';
import { type Navigation, type SidebarItem } from './navigation.ts';
import type { Page } from './page-tree.ts';
import { canonicalUrl } from './seo.ts';

type LlmsConfig = Pick<DocsConfig, 'name' | 'seo' | 'access'>;

/**
 * The Markdown twin of a page: the same URL with `.md` added (`/guides/auth` is `/guides/auth.md`; the
 * home page, `/`, is `/index.md`).
 */
export function markdownTwinPath(path: string): string {
  return path === '/' ? '/index.md' : `${path}.md`;
}

/**
 * The page a request for a Markdown twin means: the page at `requested`, or the home page for `/index`
 * (the twin of `/` is `/index.md`). Returns `undefined` when no page has that path.
 */
export function resolveTwinTarget(
  pages: readonly Pick<Page, 'path'>[],
  requested: string,
): string | undefined {
  const path = requested.startsWith('/') ? requested : `/${requested}`;
  const has = (p: string) => pages.some((page) => page.path === p);
  if (has(path)) return path;
  return path === '/index' && has('/') ? '/' : undefined;
}

export interface PublicPage {
  page: Page;
  /** The navigation group the page sits in, or `undefined` for pages the navigation does not list. */
  section?: string;
}

/**
 * The pages that belong in machine-readable outputs, in reading order: not hidden, not behind an access
 * rule. Each carries the top-level group it is listed under; pages the navigation leaves out come last.
 */
export function publicPages(
  config: Pick<DocsConfig, 'access'>,
  nav: Navigation,
): PublicPage[] {
  const seen = new Set<string>();
  const out: PublicPage[] = [];
  const add = (page: Page, section: string | undefined) => {
    if (seen.has(page.path) || !isIndexable(page, config)) return;
    seen.add(page.path);
    out.push({ page, ...(section && { section }) });
  };
  const walk = (items: readonly SidebarItem[], section: string | undefined) => {
    for (const item of items) {
      if (item.type === 'page') add(item.page, section);
      else if (item.type === 'group') walk(item.items, section ?? item.title);
    }
  };
  for (const tab of nav.tabs) walk(tab.sidebar, undefined);
  for (const page of nav.unlisted) add(page, undefined);
  return out;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The URL a tool should fetch for a page: the Markdown twin, absolute when `seo.siteUrl` is known. */
function twinUrl(config: LlmsConfig, page: Page): string {
  const path = markdownTwinPath(page.path);
  return config.seo.siteUrl ? canonicalUrl(config.seo.siteUrl, path) : path;
}

function header(config: LlmsConfig): string[] {
  const lines = [`# ${oneLine(config.name)}`];
  if (config.seo.description)
    lines.push('', `> ${oneLine(config.seo.description)}`);
  return lines;
}

/**
 * `llms.txt`, following https://llmstxt.org: the site name, a summary, then a list of links per
 * navigation group, each to the page's Markdown twin with its description. Pages the navigation does not
 * list go under "Optional", which tools may skip when they are short of room.
 */
export function buildLlmsTxt(config: LlmsConfig, nav: Navigation): string {
  const lines = header(config);
  const sections = new Map<string, PublicPage[]>();
  for (const entry of publicPages(config, nav)) {
    const key = entry.section ?? 'Optional';
    sections.set(key, [...(sections.get(key) ?? []), entry]);
  }
  // "Optional" is always last, whatever the navigation calls its groups.
  const optional = sections.get('Optional');
  sections.delete('Optional');
  if (optional) sections.set('Optional', optional);
  for (const [section, entries] of sections) {
    lines.push('', `## ${section}`, '');
    for (const { page } of entries) {
      const description = page.description
        ? `: ${oneLine(page.description)}`
        : '';
      lines.push(
        `- [${oneLine(page.title)}](${twinUrl(config, page)})${description}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `llms-full.txt`: the whole documentation in one file. Each page is its Markdown, headed by its title
 * and the address it lives at, and pages are separated by a rule.
 */
export async function buildLlmsFullTxt(
  config: LlmsConfig,
  nav: Navigation,
  markdownOf: (page: Page) => string | Promise<string>,
): Promise<string> {
  const blocks = await Promise.all(
    publicPages(config, nav).map(async ({ page }) => {
      const [title, ...rest] = (await markdownOf(page)).trimEnd().split('\n');
      const url = config.seo.siteUrl
        ? canonicalUrl(config.seo.siteUrl, page.path)
        : page.path;
      return [title, '', `Source: ${url}`, ...rest].join('\n');
    }),
  );
  return `${[header(config).join('\n'), ...blocks].join('\n\n---\n\n')}\n`;
}
