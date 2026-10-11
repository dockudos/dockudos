import type { LayoutName } from './config.ts';

/** Where a generated page came from: an API source and, for an endpoint, its method and path. */
export interface ApiPageMeta {
  /** The `name` of the source in docs.json. */
  source: string;
  /** `overview`, `operation`, `webhook`, `channel`, `type`, ... */
  kind: string;
  /** HTTP method in lower case, for operations. */
  method?: string;
  /** Path of the endpoint, for operations. */
  endpoint?: string;
  /** Sidebar group: a tag, a path segment, a kind of type. */
  group?: string;
  /** Position in the source, to keep the spec's order. */
  order?: number;
}

export interface Page {
  type: 'page';
  /** URL path, e.g. `/guides/auth`. The index page of a folder takes the folder's path. */
  path: string;
  /** Path segments without the leading slash; empty for the root index. */
  slug: string[];
  /** Source file relative to the docs folder, with forward slashes. */
  file: string;
  title: string;
  description?: string;
  icon?: string;
  /** Routable but left out of generated navigation. */
  hidden: boolean;
  /** Shorter label for navigation; falls back to `title`. */
  sidebarTitle?: string;
  /** Per-page override of `theme.layout`. */
  layout?: LayoutName;
  /** `false` hides the kudos widget on this page. */
  kudos?: boolean;
  /** Set on pages written by `dockudos generate`. */
  api?: ApiPageMeta;
  /** The page's address inside its version and language, without their prefix: `/guides/auth`. */
  rel: string;
  /** The file relative to the version and language folder; what `navigation` in docs.json refers to. */
  contentFile: string;
  /** Language of the page, on sites with `i18n`. */
  locale?: string;
  /** Version of the page, on sites with `versions`. */
  version?: string;
  /** Set when the page has no translation: its text is in this language. */
  fallbackLocale?: string;
  /** `YYYY-MM-DD` from the frontmatter, for feeds. */
  date?: string;
  tags?: string[];
}

/** A discovered file plus whatever metadata was read from it. */
export interface PageSource {
  file: string;
  title?: string;
  description?: string;
  icon?: string;
  hidden?: boolean;
  sidebarTitle?: string;
  layout?: LayoutName;
  kudos?: boolean;
  api?: ApiPageMeta;
  /** A stand-in: the file is in this language, shown where the page has no translation. */
  fallbackLocale?: string;
  /** For a stand-in, the page's file relative to its own language folder (the translation would be there). */
  contentFile?: string;
  date?: string;
  tags?: string[];
}

export interface BuildTreeOptions {
  /** URL prefix for every page: `urlPrefix` plus the variant's prefix. */
  prefix?: string;
  /** The variant's folder (`v1/fr`): files below it are routed without it. Others keep their whole path. */
  dir?: string;
  /** Segments of the variant's prefix, so `slug` matches the address. */
  segments?: readonly string[];
  locale?: string;
  version?: string;
}

export interface Folder {
  type: 'folder';
  name: string;
  path: string;
  /** The folder's own `index` page, if any. */
  index?: Page;
  children: PageNode[];
}

export type PageNode = Page | Folder;

export interface PageTree {
  /** The root `index` page, if any. */
  index?: Page;
  children: PageNode[];
  /** Every page in tree order (index first, pages before folders, each alphabetical). */
  pages: Page[];
}

const DOC_EXT = /\.mdx?$/;

/**
 * Build a page tree from file paths relative to the docs folder. Non-markdown files are ignored.
 * With `prefix` (`/docs`) every page path starts with it; `slug` stays relative to the mount point.
 */
export function buildPageTree(
  sources: readonly (string | PageSource)[],
  {
    prefix = '',
    dir = '',
    segments: variantSegments = [],
    locale,
    version,
  }: BuildTreeOptions = {},
): PageTree {
  const root: Folder = {
    type: 'folder',
    name: '',
    path: prefix || '/',
    children: [],
  };

  const entries = sources
    .map((s) => (typeof s === 'string' ? { file: s } : s))
    .map((s) => ({
      ...s,
      file: s.file.replaceAll('\\', '/').replace(/^\.?\//, ''),
    }))
    .sort((a, b) => compare(a.file, b.file));

  const strip = dir ? `${dir.replace(/\/+$/, '')}/` : '';
  for (const { file, ...meta } of entries) {
    if (!DOC_EXT.test(file)) continue;

    // A stand-in lives in another language's folder but is routed as if it were in this one.
    const contentFile =
      meta.contentFile ??
      (strip && file.startsWith(strip) ? file.slice(strip.length) : file);
    const segments = contentFile
      .replace(DOC_EXT, '')
      .split('/')
      .map(toUrlSegment);
    const leaf = segments.pop() as string;
    let folder = root;
    for (const name of segments) {
      folder = getFolder(folder, name);
    }

    const isIndex = leaf === 'index';
    const within = isIndex ? segments : [...segments, leaf];
    const slug = [...variantSegments, ...within];
    const page: Page = {
      type: 'page',
      path: prefix + (within.length ? '/' + within.join('/') : '') || '/',
      slug,
      rel: within.length ? '/' + within.join('/') : '/',
      contentFile,
      file,
      title:
        meta.title ??
        titleFromSlug(isIndex ? (segments.at(-1) ?? 'Home') : leaf),
      hidden: meta.hidden ?? false,
    };
    if (meta.description) page.description = meta.description;
    if (meta.icon) page.icon = meta.icon;
    if (meta.sidebarTitle) page.sidebarTitle = meta.sidebarTitle;
    if (meta.layout) page.layout = meta.layout;
    if (meta.kudos !== undefined) page.kudos = meta.kudos;
    if (meta.api) page.api = meta.api;
    if (locale) page.locale = locale;
    if (version) page.version = version;
    if (meta.fallbackLocale) page.fallbackLocale = meta.fallbackLocale;
    if (meta.date) page.date = meta.date;
    if (meta.tags?.length) page.tags = meta.tags;

    if (isIndex) folder.index = page;
    else folder.children.push(page);
  }

  sortFolder(root);
  const pages: Page[] = [];
  collect(root, pages);
  return { index: root.index, children: root.children, pages };
}

function getFolder(parent: Folder, name: string): Folder {
  const existing = parent.children.find(
    (c): c is Folder => c.type === 'folder' && c.name === name,
  );
  if (existing) return existing;
  const folder: Folder = {
    type: 'folder',
    name,
    path: `${parent.path === '/' ? '' : parent.path}/${name}`,
    children: [],
  };
  parent.children.push(folder);
  return folder;
}

function sortFolder(folder: Folder): void {
  folder.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'page' ? -1 : 1;
    return compare(sortKey(a), sortKey(b));
  });
  for (const child of folder.children) {
    if (child.type === 'folder') sortFolder(child);
  }
}

function sortKey(node: PageNode): string {
  return node.type === 'page' ? node.path : node.name;
}

function collect(folder: Folder, out: Page[]): void {
  if (folder.index) out.push(folder.index);
  for (const child of folder.children) {
    if (child.type === 'page') out.push(child);
    else collect(child, out);
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function titleFromSlug(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Make one path segment safe for a URL: collapse whitespace, drop characters that break URLs. */
export function toUrlSegment(segment: string): string {
  return segment
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[#?%\\]/g, '');
}

/**
 * What a page's address starts with before its own part: `urlPrefix` plus the version and language (`/docs/v1/fr`),
 * or '' at the root. Relative links in the page's file resolve below it.
 */
export function pageMount(page: Pick<Page, 'path' | 'rel'>): string {
  if (page.rel === '/') return page.path === '/' ? '' : page.path;
  return page.path.slice(0, page.path.length - page.rel.length);
}
