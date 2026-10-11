import { type AccessRule, bearerToken, decideLogin, type Principal } from '@dockudos/core';

export interface PlatformVerifyOptions {
  /** Base URL of the dockudos platform, e.g. `https://platform.example.com`. */
  platformUrl: string;
  /** For tests, or to reach the platform through a proxy. */
  fetch?: typeof fetch;
  /** Seconds to remember an answer for one credential. Default 30; 0 turns the cache off. */
  cacheSeconds?: number;
}

/**
 * A `verify` function for `createAccessProxy({ verify })` and the assistant and MCP routes: it asks the dockudos
 * platform who the caller is (`Authorization: Bearer dkd_...` API key, or the platform session cookie) and applies the
 * rule's `roles` and `groups` to the answer. Platform teams appear as groups `team:<slug>` and roles
 * `team:<slug>:<role>`, so `{ "require": "custom", "groups": ["team:acme"] }` admits the Acme team.
 * Anything that goes wrong (platform down, bad answer) refuses the request.
 */
export function createPlatformVerify({
  platformUrl,
  fetch: doFetch = fetch,
  cacheSeconds = 30,
}: PlatformVerifyOptions) {
  const base = platformUrl.replace(/\/+$/, '');
  const cache = new Map<string, { until: number; principal: Principal | undefined }>();

  async function principalOf(request: Request): Promise<Principal | undefined> {
    const bearer = bearerToken(request.headers.get('authorization'));
    const cookie = request.headers.get('cookie');
    if (!bearer && !cookie) return undefined;
    const key = bearer ? `b:${bearer}` : `c:${cookie}`;
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.principal;
    let principal: Principal | undefined;
    try {
      const res = await doFetch(`${base}/api/v1/principal`, {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : { cookie: cookie as string },
      });
      if (res.ok) {
        const body = (await res.json()) as { principal?: Principal };
        const p = body.principal;
        if (p && typeof p.sub === 'string' && Array.isArray(p.roles) && Array.isArray(p.groups)) principal = p;
      }
    } catch {
      principal = undefined;
    }
    if (cacheSeconds > 0 && principal) {
      // Only successes are cached: a refusal might be a revoked key coming back, a failure a platform restart.
      if (cache.size > 500) cache.clear();
      cache.set(key, { until: Date.now() + cacheSeconds * 1000, principal });
    }
    return principal;
  }

  return async function verify(request: Request, rule: AccessRule): Promise<boolean> {
    return decideLogin(rule, await principalOf(request)) === 'allow';
  };
}
