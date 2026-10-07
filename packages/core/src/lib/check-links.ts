import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { expandIncludes } from './include.ts';
import { extractToc } from './helpers.ts';
import { extractLinks, resolveDocLink } from './links.ts';
import type { PageTree } from './page-tree.ts';

export interface LinkProblem {
  /** File relative to the docs folder. */
  file: string;
  line: number;
  href: string;
  message: string;
  /** Errors fail the check; warnings (unreachable external hosts, timeouts) do not. */
  severity: 'error' | 'warning';
}

export interface CheckLinksOptions {
  /** Absolute path of the docs folder. */
  docsDir: string;
  /** Absolute path of `public/`, for links like `/logo.svg`. */
  publicDir?: string;
  tree: PageTree;
  /** Mount point of the docs in the site (`urlPrefix`), so relative links resolve to real page paths. */
  prefix?: string;
  /** Old URLs that redirect somewhere, so links to them still count as valid. */
  redirectSources?: readonly string[];
  /** Also request `http(s)` links. Off by default: slow and flaky. */
  external?: boolean;
  /** Per-request timeout for external links, in ms. Default 10000. */
  timeout?: number;
  /** Replaceable for tests. */
  fetch?: typeof fetch;
}

const DOC_EXT = /\.mdx?$/;
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Check every link and image in the docs. Internal links must point at a
 * page (or a redirect) and, with `#anchor`, at a heading that exists there;
 * asset links must point at a file. Each problem names the source file and line.
 */
export async function checkLinks(
  options: CheckLinksOptions,
): Promise<LinkProblem[]> {
  const { docsDir, publicDir, tree, redirectSources = [] } = options;
  const read = (file: string) => readFile(join(docsDir, file), 'utf8');

  const pageByPath = new Map(tree.pages.map((p) => [p.path, p]));
  const redirects = new Set(
    redirectSources.map((s) => (s.length > 1 ? s.replace(/\/+$/, '') : s)),
  );

  // Heading ids per page, with `<include>`s expanded because included headings render on the page.
  const idsCache = new Map<string, Set<string>>();
  const idsOf = async (file: string) => {
    let ids = idsCache.get(file);
    if (!ids) {
      let source = await read(file);
      try {
        source = await expandIncludes(source, { file, read });
      } catch {
        // a broken include is reported elsewhere; check against what we can read
      }
      ids = new Set(
        extractToc(source, { minDepth: 1, maxDepth: 6 }).map((t) => t.id),
      );
      idsCache.set(file, ids);
    }
    return ids;
  };

  const files = (
    await readdir(docsDir, { recursive: true, withFileTypes: true })
  )
    .filter((e) => e.isFile() && DOC_EXT.test(e.name))
    .map((e) =>
      relative(docsDir, join(e.parentPath, e.name)).split(sep).join('/'),
    )
    .filter(
      (f) =>
        !f
          .split('/')
          .some((part) => part.startsWith('.') || part === 'node_modules'),
    )
    .sort();

  const problems: LinkProblem[] = [];
  const externals: { file: string; line: number; href: string }[] = [];

  for (const file of files) {
    const source = await read(file);
    const add = (line: number, href: string, message: string) =>
      problems.push({ file, line, href, message, severity: 'error' });

    for (const { href, line, kind, alt, decorative } of extractLinks(source)) {
      if (kind === 'image' && !decorative && (alt === null || alt === '')) {
        problems.push({
          file,
          line,
          href,
          severity: 'warning',
          message:
            alt === null
              ? 'image has no alt attribute; add alt="" if it is only decoration'
              : 'image has no alt text; describe it, or use <img alt="" /> if it is only decoration',
        });
      }
      const link = resolveDocLink(file, href, { prefix: options.prefix });

      if (link.kind === 'external') {
        if (/^https?:\/\//i.test(href)) externals.push({ file, line, href });
        continue;
      }

      if (link.kind === 'anchor') {
        const own = tree.pages.find((p) => p.file === file);
        // Partials have no page of their own; their anchors depend on where they are included.
        if (own && !(await idsOf(file)).has(link.hash)) {
          add(line, href, `no heading with id "${link.hash}" on this page`);
        }
        continue;
      }

      if (link.kind === 'asset') {
        const target = link.href.split(/[?#]/)[0] as string;
        const onDisk = target.startsWith('/')
          ? publicDir && join(publicDir, decodeURI(target))
          : join(docsDir, ...file.split('/').slice(0, -1), decodeURI(target));
        if (onDisk && !(await exists(onDisk)))
          add(line, href, `file not found: ${target}`);
        continue;
      }

      const target = pageByPath.get(link.path);
      if (!target) {
        if (!redirects.has(link.path))
          add(line, href, `no page at ${link.path}`);
        continue;
      }
      if (link.hash && !(await idsOf(target.file)).has(link.hash)) {
        add(line, href, `${link.path} has no heading with id "${link.hash}"`);
      }
    }
  }

  if (options.external)
    problems.push(...(await checkExternal(externals, options)));
  return problems;
}

async function checkExternal(
  links: readonly { file: string; line: number; href: string }[],
  { timeout = 10_000, fetch: doFetch = fetch }: CheckLinksOptions,
): Promise<LinkProblem[]> {
  const unique = [...new Set(links.map((l) => l.href.split('#')[0] as string))];
  const verdict = new Map<
    string,
    { severity: 'error' | 'warning'; message: string } | undefined
  >();

  const probe = async (url: string) => {
    const request = async (method: 'HEAD' | 'GET') =>
      doFetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
    try {
      let res = await request('HEAD');
      // Some servers reject HEAD; try again with GET before judging.
      if (res.status === 405 || res.status === 501 || res.status === 403)
        res = await request('GET');
      if (res.status === 404 || res.status === 410) {
        verdict.set(url, {
          severity: 'error',
          message: `external link is dead (HTTP ${res.status})`,
        });
      } else if (res.status >= 400) {
        // 401/403/429/5xx: the site is there but will not say; do not fail the build over it.
        verdict.set(url, {
          severity: 'warning',
          message: `could not verify (HTTP ${res.status})`,
        });
      }
    } catch (e) {
      const timedOut =
        e instanceof Error &&
        (e.name === 'TimeoutError' || e.name === 'AbortError');
      verdict.set(url, {
        severity: 'warning',
        message: timedOut
          ? `no response within ${timeout} ms`
          : `could not reach host (${(e as Error).message})`,
      });
    }
  };

  // Bounded concurrency: do not hit hundreds of hosts at once.
  const queue = [...unique];
  await Promise.all(
    Array.from({ length: Math.min(8, queue.length) }, async () => {
      for (let url = queue.shift(); url; url = queue.shift()) await probe(url);
    }),
  );

  return links.flatMap((l) => {
    const v = verdict.get(l.href.split('#')[0] as string);
    return v ? [{ file: l.file, line: l.line, href: l.href, ...v }] : [];
  });
}

/** One line per problem, `file:line  href  message`, errors first. */
export function formatLinkProblems(problems: readonly LinkProblem[]): string {
  return [...problems]
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
    )
    .map(
      (p) =>
        `${p.severity === 'error' ? 'error  ' : 'warning'} ${p.file}:${p.line}  ${p.href}  ${p.message}`,
    )
    .join('\n');
}
