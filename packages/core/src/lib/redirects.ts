import type { DocsConfig } from './config.ts';

export type Redirect = DocsConfig['redirects'][number];

export class RedirectError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid redirects in docs.json:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'RedirectError';
    this.issues = issues;
  }
}

const isExternal = (url: string) => /^https?:\/\//.test(url);
const isPattern = (path: string) => /[:*()]/.test(path);

function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Check redirects and flatten chains (`/a` to `/b` to `/c` becomes `/a` to
 * `/c`) so a visitor takes one hop. Throws a `RedirectError` listing every
 * duplicate source, loop, or source that would shadow a real page.
 * Path patterns such as `/old/:slug*` pass through untouched.
 */
export function resolveRedirects(
  redirects: readonly Redirect[],
  pagePaths: readonly string[] = [],
): Redirect[] {
  const issues: string[] = [];
  const bySource = new Map<string, Redirect>();
  const pages = new Set(pagePaths.map(normalize));

  redirects.forEach((r, i) => {
    const source = normalize(r.source);
    const where = `redirects[${i}]`;
    if (bySource.has(source)) {
      issues.push(`${where}: duplicate source "${source}"`);
      return;
    }
    if (pages.has(source)) {
      issues.push(
        `${where}: source "${source}" is an existing page and would be shadowed`,
      );
    }
    bySource.set(source, {
      ...r,
      source,
      destination: isExternal(r.destination)
        ? r.destination
        : normalize(r.destination),
    });
  });

  const resolved: Redirect[] = [];
  for (const [source, redirect] of bySource) {
    const seen = new Set([source]);
    let destination = redirect.destination;
    let permanent = redirect.permanent;
    let looped = false;
    while (
      !isExternal(destination) &&
      !isPattern(destination) &&
      bySource.has(destination)
    ) {
      if (seen.has(destination)) {
        looped = true;
        break;
      }
      seen.add(destination);
      const next = bySource.get(destination) as Redirect;
      destination = next.destination;
      permanent = permanent && next.permanent;
    }
    if (looped) {
      issues.push(`redirect loop: ${[...seen, destination].join(' -> ')}`);
      continue;
    }
    resolved.push({ source, destination, permanent });
  }

  if (issues.length) throw new RedirectError(issues);
  return resolved;
}
