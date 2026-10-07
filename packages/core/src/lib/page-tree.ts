export interface Page {
  type: 'page';
  /** URL path, e.g. `/guides/auth`. The index page of a folder takes the folder's path. */
  path: string;
  /** Path segments without the leading slash; empty for the root index. */
  slug: string[];
  /** Source file relative to the docs folder, with forward slashes. */
  file: string;
  title: string;
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

/** Build a page tree from file paths relative to the docs folder. Non-markdown files are ignored. */
export function buildPageTree(files: readonly string[]): PageTree {
  const root: Folder = { type: 'folder', name: '', path: '/', children: [] };

  for (const raw of [...files].sort(compare)) {
    const file = raw.replaceAll('\\', '/').replace(/^\.?\//, '');
    if (!DOC_EXT.test(file)) continue;

    const segments = file.replace(DOC_EXT, '').split('/');
    const leaf = segments.pop() as string;
    let folder = root;
    for (const name of segments) {
      folder = getFolder(folder, name);
    }

    const isIndex = leaf === 'index';
    const slug = isIndex ? segments : [...segments, leaf];
    const page: Page = {
      type: 'page',
      path: '/' + slug.join('/'),
      slug,
      file,
      title: titleFromSlug(isIndex ? (segments.at(-1) ?? 'Home') : leaf),
    };

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

function titleFromSlug(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
