import {
  type AccessRule,
  bearerToken,
  checkBasic,
  checkToken,
  findAccessRule,
  parseCredentials,
  parseTokens,
} from '@dockudos/core';
import { NextResponse } from 'next/server.js';

export interface AccessOptions {
  /** Rules to apply. Default: the `access.rules` of `docs.json`, which `withDocs()` passes along. */
  rules?: readonly AccessRule[];
  /**
   * Decide for rules with `require: "custom"`: return `true` to let the request through, `false` to refuse
   * it, or a `Response` to send instead (a redirect to your sign-in page, for example).
   */
  verify?: (
    request: Request,
    rule: AccessRule,
  ) => boolean | Response | Promise<boolean | Response>;
  /** Where secrets are read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

const NO_STORE = { 'cache-control': 'private, no-store' };

const refuse = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...NO_STORE,
      ...headers,
    },
  });

/** The rules `withDocs()` put in the build from `docs.json`. */
export function accessRulesFromBuild(): AccessRule[] {
  // Written out as `process.env.NAME` so Next.js can replace it at build time.
  const raw = process.env.DOCKUDOS_ACCESS;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AccessRule[];
  } catch {
    return [];
  }
}

const misconfigured = (rule: AccessRule, name: string) => {
  // The visitor learns nothing; the person running the site learns what to set.
  console.error(
    `dockudos: access rule for ${rule.paths.join(', ')} needs the ${name} environment variable. Refusing requests until it is set.`,
  );
  return refuse(503, 'Access control is not configured for this page.');
};

/**
 * Check one request against one rule. Returns `undefined` to let it through, or the `Response` to send:
 * 401 with a challenge, 404 for `deny`, or 503 when the secret the rule needs is not set. It never lets a
 * request through because something is missing.
 */
export async function authorize(
  request: Request,
  rule: AccessRule,
  { verify, env = process.env }: Pick<AccessOptions, 'verify' | 'env'> = {},
): Promise<Response | undefined> {
  switch (rule.require) {
    case 'deny':
      return refuse(404, 'Not found');

    case 'basic': {
      const name = rule.secretEnv ?? 'DOCKUDOS_BASIC_AUTH';
      const credentials = parseCredentials(env[name]);
      if (credentials.length === 0) return misconfigured(rule, name);
      if (checkBasic(request.headers.get('authorization'), credentials))
        return undefined;
      return refuse(401, 'Authentication required', {
        'www-authenticate': `Basic realm="${(rule.realm ?? 'Documentation').replace(/["\\\r\n]/g, '')}", charset="UTF-8"`,
      });
    }

    case 'token': {
      const name = rule.secretEnv ?? 'DOCKUDOS_TOKEN';
      const tokens = parseTokens(env[name]);
      if (tokens.length === 0)
        return misconfigured(rule, `${name} (at least 8 characters)`);
      const given =
        bearerToken(request.headers.get('authorization')) ??
        request.headers.get('x-docs-token');
      if (checkToken(given, tokens)) return undefined;
      return refuse(401, 'A valid token is required', {
        'www-authenticate': 'Bearer',
      });
    }

    case 'custom': {
      if (!verify)
        return misconfigured(
          rule,
          'a verify function (createAccessProxy({ verify }))',
        );
      const result = await verify(request, rule);
      if (result instanceof Response) return result;
      return result ? undefined : refuse(403, 'Forbidden');
    }
  }
}

/**
 * The guard for `src/proxy.ts`. It runs before every route it is pointed at (pages, `/print`, API routes,
 * files in `public/`) and applies the rules from `docs.json`:
 *
 *     // src/proxy.ts
 *     import { createAccessProxy } from '@dockudos/next/access';
 *     export const proxy = createAccessProxy();
 *     export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
 *
 * Pages it lets through are marked `private, no-store` and `noindex`, so a CDN or search engine never
 * keeps a copy to hand to someone else.
 */
export function createAccessProxy(options: AccessOptions = {}) {
  return async function proxy(request: Request): Promise<Response | undefined> {
    const rules = options.rules ?? accessRulesFromBuild();
    if (rules.length === 0) return undefined;

    const rule = findAccessRule(rules, new URL(request.url).pathname);
    if (!rule) return undefined;

    const denied = await authorize(request, rule, options);
    if (denied) return denied;

    const response = NextResponse.next();
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  };
}

/**
 * For route handlers that serve a page's content under another URL (`/api/markdown?path=…`): refuse
 * unless the visitor may see that page. Returns `undefined` when the page is open or the visitor is allowed.
 */
export async function authorizePage(
  request: Request,
  pagePath: string,
  options: AccessOptions = {},
): Promise<Response | undefined> {
  const rule = findAccessRule(
    options.rules ?? accessRulesFromBuild(),
    pagePath,
  );
  return rule ? authorize(request, rule, options) : undefined;
}
