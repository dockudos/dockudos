import { FenceTracker } from './fence.ts';
import { toUrlSegment } from './page-tree.ts';

export type DocLink =
  | { kind: 'external'; href: string }
  /** `#section` on the current page. */
  | { kind: 'anchor'; hash: string }
  /** Another docs page, as a site path such as `/guides/auth`. */
  | { kind: 'internal'; path: string; hash?: string }
  /** A non-page file such as an image or download. */
  | { kind: 'asset'; href: string };

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const DOC_EXT = /\.mdx?$/;

/**
 * Classify a link written in the file `from` (docs-relative, forward slashes)
 * and resolve internal ones to site paths. Relative links get `prefix` (the docs mount point);
 * absolute ones are already full site paths. `./other.mdx#h` in
 * `guides/auth.mdx` becomes `{ kind: 'internal', path: '/guides/other', hash: 'h' }`.
 */
export function resolveDocLink(
  from: string,
  href: string,
  { prefix = '' }: { prefix?: string } = {},
): DocLink {
  if (EXTERNAL.test(href)) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) };

  const hashAt = href.indexOf('#');
  const rawPath = (hashAt === -1 ? href : href.slice(0, hashAt)).split(
    '?',
  )[0] as string;
  const hash = hashAt === -1 ? undefined : href.slice(hashAt + 1) || undefined;

  const last = rawPath.split('/').pop() ?? '';
  if (/\.[a-z0-9]+$/i.test(last) && !DOC_EXT.test(last))
    return { kind: 'asset', href };

  const parts = rawPath.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of rawPath.replace(DOC_EXT, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  if (parts.at(-1) === 'index') parts.pop();
  const rel = parts.map((s) => toUrlSegment(decodeURIComponent(s))).join('/');
  // Relative links are relative to the docs folder, so they get the mount prefix. Absolute
  // `/site/paths` are taken as written.
  const path = rawPath.startsWith('/')
    ? '/' + rel
    : rel
      ? `${prefix}/${rel}`
      : prefix || '/';
  return hash ? { kind: 'internal', path, hash } : { kind: 'internal', path };
}

export interface FoundLink {
  href: string;
  /** 1-based line in the file, counting any frontmatter. */
  line: number;
  kind: 'link' | 'image';
}

/**
 * Links and images written in a markdown/MDX source: `[t](href)`,
 * `![alt](src)`, reference definitions, and `href=` / `src=` on JSX or HTML.
 * Code fences and inline code are skipped. Line numbers refer to the whole
 * file, so they can be shown in error messages.
 */
export function extractLinks(source: string): FoundLink[] {
  const found: FoundLink[] = [];
  const fence = new FenceTracker();

  for (const [i, raw] of source.split(/\r?\n/).entries()) {
    if (fence.inCode(raw)) continue;

    const line = raw.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
    const add = (href: string | undefined, kind: FoundLink['kind']) => {
      if (href) found.push({ href, line: i + 1, kind });
    };

    for (const m of line.matchAll(
      /(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
    )) {
      add(m[2] ?? m[3], m[1] ? 'image' : 'link');
    }
    add(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(line)?.[1], 'link');
    for (const m of line.matchAll(
      /<(\w+)[^>]*?\s(href|src)=(?:"([^"]*)"|'([^']*)')/g,
    )) {
      add(m[3] ?? m[4], m[2] === 'src' ? 'image' : 'link');
    }
  }
  return found;
}
