import { type AccessRule, findAccessRule } from '@dockudos/core';
import { type AccessOptions, authorize } from './access.ts';

/** What one request may see of the protected parts of the site. */
export interface Viewer {
  /** May this request read the page at `path`? Pages no rule covers are open to everyone. */
  canSee(path: string): boolean;
  /**
   * A short name for the set of rules this request passed, `''` for none. Two requests with the same scope see the
   * same pages, so anything computed for one (an index, a cached answer) may be used for the other and for no one
   * else.
   */
  scope: string;
}

/** A visitor who has passed no rule. */
/**
 * Work out which `access` rules a request satisfies. Every rule is checked once, with the same code that guards the
 * page route, so search, the assistant and the MCP server cannot be more generous than the pages themselves. A rule
 * that cannot be checked (a missing secret, a failing `verify`) counts as not passed.
 */
export async function resolveViewer(
  request: Request,
  rules: readonly AccessRule[],
  options: Pick<AccessOptions, 'verify' | 'env'> = {},
): Promise<Viewer> {
  if (rules.length === 0) return { canSee: () => true, scope: '' };
  const passed = await Promise.all(
    rules.map(async (rule) => {
      try {
        return (await authorize(request, rule, options)) === undefined;
      } catch {
        return false;
      }
    }),
  );
  const allowed = new Set(rules.filter((_, i) => passed[i]));
  return {
    canSee: (path) => {
      const rule = findAccessRule(rules, path);
      return !rule || allowed.has(rule);
    },
    scope: passed.flatMap((ok, i) => (ok ? [i] : [])).join(','),
  };
}
