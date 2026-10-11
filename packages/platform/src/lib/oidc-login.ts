import {
  authorizationUrl,
  createPkce,
  discoverProvider,
  exchangeCode,
  fetchJwks,
  type Jwk,
  type OidcProvider,
  randomString,
  readCookie,
  safeEqual,
  safeReturnTo,
  serializeCookie,
  signToken,
  verifyIdToken,
  verifyToken,
} from '@dockudos/core';
import {
  type Auth,
  DOCS_SESSION_COOKIE,
  PLATFORM_SESSION_COOKIE,
} from './auth.ts';
import type { Clock } from './clock.ts';
import { systemClock } from './clock.ts';
import { type Logger, silentLogger } from './logger.ts';

export interface OidcLoginOptions {
  auth: Auth;
  /** The platform's public origin; the provider redirects back to `${publicUrl}/auth/callback`. */
  publicUrl: string;
  secret: string;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    rolesClaim: string;
    groupsClaim: string;
  };
  fetch?: typeof fetch;
  clock?: Clock;
  log?: Logger;
  sessionHours?: number;
  /**
   * Also sign the person in to private docs: set the cookie `@dockudos/next` reads, signed with the docs site's
   * `DOCKUDOS_AUTH_SECRET`. `domain` (for example `.example.com`) lets a docs site on a sibling subdomain see it.
   */
  docsSession?: { secret: string; domain?: string };
}

export const LOGIN_COOKIE = 'dockudos_platform_login';
export const CALLBACK_PATH = '/auth/callback';
const domainAttr = (d?: string) =>
  d && /^\.?[a-z0-9.-]+$/i.test(d) ? `; Domain=${d}` : '';
const NO_STORE = { 'cache-control': 'no-store' };
const text = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
  });

/**
 * Sign-in with any OpenID Connect provider: authorization code with PKCE, state and nonce checked, the ID
 * token's signature, issuer, audience and expiry verified (all in `@dockudos/core`, shared with private docs).
 */
export function createOidcLogin({
  auth,
  publicUrl,
  secret,
  oidc,
  fetch: doFetch = fetch,
  clock = systemClock,
  log = silentLogger,
  sessionHours = 12,
  docsSession,
}: OidcLoginOptions) {
  const nowSec = () => Math.floor(clock().getTime() / 1000);
  const secure = publicUrl.startsWith('https:');
  let provider: { value: OidcProvider; until: number } | undefined;
  let keys: { value: Jwk[]; until: number } | undefined;
  const providerMeta = async () => {
    if (!provider || provider.until < nowSec())
      provider = {
        value: await discoverProvider(oidc.issuer, doFetch),
        until: nowSec() + 3600,
      };
    return provider.value;
  };
  const keysFor = async (meta: OidcProvider, fresh = false) => {
    if (fresh || !keys || keys.until < nowSec())
      keys = {
        value: await fetchJwks(meta.jwksUri, doFetch),
        until: nowSec() + 3600,
      };
    return keys.value;
  };

  async function login(request: Request): Promise<Response> {
    let meta: OidcProvider;
    try {
      meta = await providerMeta();
    } catch (error) {
      log.error('sign-in provider unreachable', { error });
      return text(502, 'The sign-in provider could not be reached.');
    }
    const returnTo = safeReturnTo(
      new URL(request.url).searchParams.get('returnTo'),
    );
    const pkce = await createPkce();
    const state = randomString();
    const nonce = randomString();
    const cookie = await signToken(
      { state, nonce, verifier: pkce.verifier, returnTo },
      secret,
      { purpose: 'platform-login', ttlSeconds: 600, now: nowSec() },
    );
    const headers = new Headers({
      location: authorizationUrl(meta, {
        clientId: oidc.clientId,
        redirectUri: publicUrl + CALLBACK_PATH,
        scopes: ['openid', 'profile', 'email'],
        state,
        nonce,
        challenge: pkce.challenge,
      }),
      ...NO_STORE,
    });
    headers.append(
      'set-cookie',
      serializeCookie(LOGIN_COOKIE, cookie, {
        maxAgeSeconds: 600,
        secure,
        path: '/auth',
      }),
    );
    return new Response(null, { status: 302, headers });
  }

  async function callback(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const pending = await verifyToken<{
      state: string;
      nonce: string;
      verifier: string;
      returnTo: string;
    }>(readCookie(request.headers.get('cookie'), LOGIN_COOKIE), secret, {
      purpose: 'platform-login',
      now: nowSec(),
    });
    if (!pending)
      return text(
        400,
        'This sign-in has expired or did not start here. Try again.',
      );
    if (params.get('error'))
      return text(403, 'The sign-in was cancelled or refused.');
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !safeEqual(state, pending.state))
      return text(
        400,
        'The sign-in response does not match the request. Try again.',
      );
    try {
      const meta = await providerMeta();
      const idToken = await exchangeCode(
        meta,
        {
          code,
          verifier: pending.verifier,
          redirectUri: publicUrl + CALLBACK_PATH,
          clientId: oidc.clientId,
          ...(oidc.clientSecret && { clientSecret: oidc.clientSecret }),
        },
        doFetch,
      );
      const check = {
        issuer: meta.issuer,
        clientId: oidc.clientId,
        nonce: pending.nonce,
        now: nowSec(),
      };
      let claims;
      try {
        claims = await verifyIdToken(idToken, {
          ...check,
          keys: await keysFor(meta),
        });
      } catch {
        claims = await verifyIdToken(idToken, {
          ...check,
          keys: await keysFor(meta, true),
        }); // keys may have rotated
      }
      const user = await auth.userFromClaims(claims, {
        rolesClaim: oidc.rolesClaim,
        groupsClaim: oidc.groupsClaim,
      });
      const headers = new Headers({
        location: safeReturnTo(pending.returnTo),
        ...NO_STORE,
      });
      headers.append(
        'set-cookie',
        serializeCookie(
          PLATFORM_SESSION_COOKIE,
          await auth.sessionToken(user),
          { maxAgeSeconds: sessionHours * 3600, secure },
        ),
      );
      headers.append(
        'set-cookie',
        serializeCookie(LOGIN_COOKIE, '', {
          maxAgeSeconds: 0,
          secure,
          path: '/auth',
        }),
      );
      if (docsSession) {
        const value = await auth.docsSession(
          await auth.principalFor({ type: 'user', user }),
          docsSession.secret,
          sessionHours,
        );
        headers.append(
          'set-cookie',
          serializeCookie(DOCS_SESSION_COOKIE, value, {
            maxAgeSeconds: sessionHours * 3600,
            secure,
          }) + domainAttr(docsSession.domain),
        );
      }
      log.info('user signed in', { user: user.id });
      return new Response(null, { status: 302, headers });
    } catch (error) {
      log.warn('sign-in failed', { error });
      return text(403, 'The sign-in could not be completed.');
    }
  }

  function logout(request: Request): Response {
    const origin = request.headers.get('origin');
    if (
      origin &&
      origin !== publicUrl &&
      origin !== new URL(request.url).origin
    )
      return text(403, 'Sign-out must be requested from this site.');
    const headers = new Headers({ location: '/', ...NO_STORE });
    headers.append(
      'set-cookie',
      serializeCookie(PLATFORM_SESSION_COOKIE, '', {
        maxAgeSeconds: 0,
        secure,
      }),
    );
    if (docsSession)
      headers.append(
        'set-cookie',
        serializeCookie(DOCS_SESSION_COOKIE, '', { maxAgeSeconds: 0, secure }) +
          domainAttr(docsSession.domain),
      );
    return new Response(null, { status: 303, headers });
  }

  return { login, callback, logout };
}
