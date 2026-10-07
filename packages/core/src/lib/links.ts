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
 * and resolve internal ones to site paths. `./other.mdx#h` in
 * `guides/auth.mdx` becomes `{ kind: 'internal', path: '/guides/other', hash: 'h' }`.
 */
export function resolveDocLink(from: string, href: string): DocLink {
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
  const path =
    '/' + parts.map((s) => toUrlSegment(decodeURIComponent(s))).join('/');
  return hash ? { kind: 'internal', path, hash } : { kind: 'internal', path };
}
