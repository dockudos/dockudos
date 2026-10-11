import {
  type AccessRule,
  bearerToken,
  checkBasic,
  checkToken,
  decideLogin,
  findAccessRule,
  negotiateLocale,
  parseCredentials,
  parseTokens,
  pathWithLocale,
  readCookie,
} from '@dockudos/core';
import { NextResponse } from 'next/server.js';
import { LOGIN_PATH, authSecret, readSession } from './session.ts';

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
  /** Language detection settings. Default: those of `docs.json`, which `withDocs()` passes along. */
  i18n?: I18nBuild;
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

    case 'login': {
      const secret = authSecret(env);
      if (!secret)
        return misconfigured(
          rule,
          'DOCKUDOS_AUTH_SECRET (at least 32 characters)',
        );
      const decision = decideLogin(rule, await readSession(request, secret));
      if (decision === 'allow') return undefined;
      if (decision === 'forbidden')
        return refuse(403, 'Your account does not have access to this page.');
      // A person opening a page goes to sign in; a script or `fetch` is told it is not signed in.
      const url = new URL(request.url);
      const wantsPage =
        request.method === 'GET' &&
        (request.headers.get('accept') ?? '').includes('text/html');
      if (wantsPage) {
        const back = encodeURIComponent(url.pathname + url.search);
        return new Response(null, {
          status: 302,
          // Absolute, because the proxy of Next.js refuses a redirect it cannot parse as a full URL.
          headers: {
            location: new URL(`${LOGIN_PATH}?returnTo=${back}`, url).toString(),
            ...NO_STORE,
          },
        });
      }
      return refuse(401, 'Sign in to see this page.');
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
    const url = new URL(request.url);
    // Signing in must work for people who are not signed in yet.
    if (url.pathname.startsWith('/api/auth/')) return undefined;

    const rules = options.rules ?? accessRulesFromBuild();
    const rule = rules.length ? findAccessRule(rules, url.pathname) : undefined;
    if (rule) {
      const denied = await authorize(request, rule, options);
      if (denied) return denied;
    }

    const redirect = languageRedirect(
      request,
      url,
      options.i18n ?? i18nFromBuild(),
    );
    if (!rule) return redirect;

    const response = redirect ?? NextResponse.next();
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  };
}

/** What the proxy needs to send first-time visitors to their language: from `docs.json`, via `withDocs()`. */
export interface I18nBuild {
  default: string;
  locales: readonly string[];
  versions?: readonly string[];
  urlPrefix?: string;
  /** Send visitors to the language of their browser. */
  detect: boolean;
}

/** The language settings `withDocs()` put in the build. */
export function i18nFromBuild(): I18nBuild | undefined {
  // Written out as `process.env.NAME` so Next.js can replace it at build time.
  const raw = process.env.DOCKUDOS_I18N;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as I18nBuild;
  } catch {
    return undefined;
  }
}

/** The cookie the language switcher sets. */
export const LOCALE_COOKIE = 'dockudos-locale';

/**
 * Send a visitor who has not picked a language to the one their browser asks for, once: a remembered choice
 * (the switcher's cookie) wins over `Accept-Language`, an address that already names a language is left alone,
 * and only page requests are redirected, never files or API calls.
 */
function languageRedirect(
  request: Request,
  url: URL,
  i18n: I18nBuild | undefined,
): Response | undefined {
  if (!i18n?.detect || (request.method !== 'GET' && request.method !== 'HEAD'))
    return undefined;
  if (!(request.headers.get('accept') ?? '').includes('text/html'))
    return undefined;
  const { pathname } = url;
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/'))
    return undefined;
  if (/\.[A-Za-z0-9]+$/.test(pathname)) return undefined;

  const remembered = readCookie(request.headers.get('cookie'), LOCALE_COOKIE);
  const chosen = i18n.locales.includes(remembered ?? '')
    ? (remembered as string)
    : negotiateLocale(
        request.headers.get('accept-language'),
        i18n.locales,
        i18n.default,
      );
  if (chosen === i18n.default) return undefined;

  const config = {
    i18n: {
      default: i18n.default,
      locales: [...i18n.locales],
      detect: true,
      messages: {},
    },
    ...(i18n.versions && {
      versions: {
        default: i18n.versions[0] as string,
        list: i18n.versions.map((name) => ({
          name,
          status: 'stable' as const,
        })),
      },
    }),
  };
  const target = pathWithLocale(config, pathname, chosen, i18n.urlPrefix);
  if (!target) return undefined;
  return new Response(null, {
    status: 307,
    headers: {
      location: new URL(target + url.search, url).toString(),
      vary: 'Accept-Language, Cookie',
      'cache-control': 'private, no-store',
    },
  });
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

export { createPlatformVerify, type PlatformVerifyOptions } from './platform-verify.ts';
