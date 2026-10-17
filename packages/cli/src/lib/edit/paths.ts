export type PathKind = 'config' | 'doc' | 'media';

const DOC = /^docs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.mdx?$/;
const MEDIA = /^public\/media\/[A-Za-z0-9._-]+$/;
const PAGE_ID = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;

export const MAX_DOC = 1024 * 1024;
export const MAX_MEDIA = 10 * 1024 * 1024;

/** What the editor may touch. Everything else in the folder (code, scripts, CI, `.git`) is out of reach. */
export function classifyPath(path: string): PathKind | undefined {
  if (path.includes('..') || path.includes('//')) return undefined;
  if (path === 'docs.json') return 'config';
  if (DOC.test(path) && !path.split('/').some((p) => p.startsWith('.')))
    return 'doc';
  if (MEDIA.test(path) && !path.split('/').at(-1)!.startsWith('.'))
    return 'media';
  return undefined;
}

export const isPageId = (id: string) => PAGE_ID.test(id);

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.slice(from, to));

/** Identify an upload by its first bytes, never by the name or content type the browser claims. */
export function sniffMedia(
  bytes: Uint8Array,
): { ext: string; type: string } | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG')
    return { ext: 'png', type: 'image/png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { ext: 'jpg', type: 'image/jpeg' };
  if (ascii(bytes, 0, 4) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return { ext: 'webp', type: 'image/webp' };
  if (ascii(bytes, 0, 4) === '%PDF')
    return { ext: 'pdf', type: 'application/pdf' };
  if (ascii(bytes, 4, 8) === 'ftyp') return { ext: 'mp4', type: 'video/mp4' };
  const head = new TextDecoder().decode(bytes.slice(0, 600));
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(head))
    return { ext: 'svg', type: 'image/svg+xml' };
  return undefined;
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};
export const mediaType = (path: string): string =>
  MEDIA_TYPES[path.split('.').at(-1)!.toLowerCase()] ??
  'application/octet-stream';

/** Remove scripts, event handlers and external references from an SVG before it is saved. */
export function cleanSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,
      '',
    );
}

type NavNode =
  | string
  | { pages?: NavNode[]; groups?: NavNode[]; [k: string]: unknown };

/** Rewrite every page id in a sidebar; returning `null` drops the entry. */
export function mapNav(
  nav: unknown,
  fn: (id: string) => string | null,
): unknown {
  if (typeof nav === 'string') return fn(nav);
  if (Array.isArray(nav))
    return nav.map((n) => mapNav(n, fn)).filter((n) => n !== null);
  if (nav && typeof nav === 'object') {
    const o = { ...(nav as Record<string, unknown>) };
    if ('pages' in o) o['pages'] = mapNav(o['pages'], fn);
    if ('groups' in o) o['groups'] = mapNav(o['groups'], fn);
    return o;
  }
  return nav;
}

/** Add `id` at the end of the first group that has a `pages` list; at the top level when there is none. */
export function addToNav(nav: unknown, id: string): unknown[] {
  const list: unknown[] = Array.isArray(nav) ? structuredClone(nav) : [];
  const place = (nodes: NavNode[]): boolean => {
    for (const n of nodes) {
      if (n && typeof n === 'object') {
        if (Array.isArray(n.pages)) {
          n.pages.push(id);
          return true;
        }
        if (Array.isArray(n.groups) && place(n.groups)) return true;
      }
    }
    return false;
  };
  if (!place(list as NavNode[]))
    list.push({ tab: 'Docs', groups: [{ group: 'Pages', pages: [id] }] });
  return list;
}
