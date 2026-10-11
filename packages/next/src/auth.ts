import {
  type DocsConfig,
  type OidcProvider,
  type Jwk,
  authorizationUrl,
  createPkce,
  discoverProvider,
  exchangeCode,
  fetchJwks,
  principalFromClaims,
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
  CALLBACK_PATH,
  LOGIN_COOKIE,
  SESSION_COOKIE,
  authSecret,
  readSession,
} from './session.ts';
import { getSite } from './server.ts';

export interface AuthOptions {
  /** Where secrets are read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** For tests, or to reach the provider through a proxy. */
  fetch?: typeof fetch;
  /** Seconds since 1970, for tests. */
  now?: () => number;
}

const NO_STORE = { 'cache-control': 'no-store' };

const fail = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
  });

interface Ready {
  auth: NonNullable<DocsConfig['auth']>;
  secret: string;
  /** Origin of the site, which the provider sends people back to. */
  base: string;
  secure: boolean;
}

interface Cached<T> {
  value: T;
  until: number;
}

/**
 * The sign-in routes, mounted under `/api/auth/` by `createDocsApi()`:
 *
 * - `GET  /api/auth/login?returnTo=/private/x` sends the visitor to the identity provider;
 * - `GET  /api/auth/callback` finishes the sign-in and sets the session cookie;
 * - `POST /api/auth/logout` clears it;
 * - `GET  /api/auth/session` says who is signed in (`{ user }`, or 401).
 *
 * Needs `auth` in docs.json and `DOCKUDOS_AUTH_SECRET` (32+ characters) in the environment. The authorization-code
 * flow with PKCE is used, state and nonce are checked, the ID token's signature, issuer, audience and expiry are
 * verified, and only paths on this site are accepted as a place to return to.
 */
export function createAuthHandlers({
  env = process.env,
  fetch: fetcher = fetch,
  now = () => Math.floor(Date.now() / 1000),
}: AuthOptions = {}) {
  let provider: Cached<OidcProvider> | undefined;
  let keys: Cached<Jwk[]> | undefined;

  async function setup(request: Request): Promise<Ready | Response> {
    const site = await getSite();
    const auth = site.config.auth;
    if (!auth)
      return fail(404, 'Sign-in is not set up. Add "auth" to docs.json.');
    const secret = authSecret(env);
    if (!secret) {
      console.error(
        'dockudos: sign-in needs DOCKUDOS_AUTH_SECRET (at least 32 characters).',
      );
      return fail(503, 'Sign-in is not configured.');
    }
    const base = site.config.seo.siteUrl
      ? new URL(site.config.seo.siteUrl).origin
      : new URL(request.url).origin;
    return { auth, secret, base, secure: base.startsWith('https:') };
  }

  async function providerFor(auth: NonNullable<DocsConfig['auth']>) {
    if (!provider || provider.until < now())
      provider = {
        value: await discoverProvider(auth.issuer, fetcher),
        until: now() + 3600,
      };
    return provider.value;
  }

  async function keysFor(meta: OidcProvider, fresh = false) {
    if (fresh || !keys || keys.until < now())
      keys = {
        value: await fetchJwks(meta.jwksUri, fetcher),
        until: now() + 3600,
      };
    return keys.value;
  }

  async function login(request: Request): Promise<Response> {
    const ready = await setup(request);
    if (ready instanceof Response) return ready;
    const { auth, secret, base, secure } = ready;
    let meta: OidcProvider;
    try {
      meta = await providerFor(auth);
    } catch (error) {
      console.error('dockudos sign-in:', error);
      return fail(502, 'The sign-in provider could not be reached.');
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
      {
        purpose: 'login',
        ttlSeconds: 600,
        now: now(),
      },
    );
    const location = authorizationUrl(meta, {
      clientId: auth.clientId,
      redirectUri: base + CALLBACK_PATH,
      scopes: auth.scopes,
      state,
      nonce,
      challenge: pkce.challenge,
    });
    const headers = new Headers({ location, ...NO_STORE });
    headers.append(
      'set-cookie',
      serializeCookie(LOGIN_COOKIE, cookie, {
        maxAgeSeconds: 600,
        secure,
        path: '/api/auth',
      }),
    );
    return new Response(null, { status: 302, headers });
  }

  async function callback(request: Request): Promise<Response> {
    const ready = await setup(request);
    if (ready instanceof Response) return ready;
    const { auth, secret, base, secure } = ready;
    const params = new URL(request.url).searchParams;
    const pending = await verifyToken<{
      state: string;
      nonce: string;
      verifier: string;
      returnTo: string;
    }>(readCookie(request.headers.get('cookie'), LOGIN_COOKIE), secret, {
      purpose: 'login',
      now: now(),
    });
    if (!pending)
      return fail(
        400,
        'This sign-in has expired or did not start here. Try again.',
      );
    if (params.get('error'))
      return fail(403, 'The sign-in was cancelled or refused.');
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !safeEqual(state, pending.state))
      return fail(
        400,
        'The sign-in response does not match the request. Try again.',
      );

    try {
      const meta = await providerFor(auth);
      const clientSecret = auth.clientSecretEnv
        ? env[auth.clientSecretEnv]
        : undefined;
      if (auth.clientSecretEnv && !clientSecret) {
        console.error(
          `dockudos: sign-in needs the ${auth.clientSecretEnv} environment variable.`,
        );
        return fail(503, 'Sign-in is not configured.');
      }
      const idToken = await exchangeCode(
        meta,
        {
          code,
          verifier: pending.verifier,
          redirectUri: base + CALLBACK_PATH,
          clientId: auth.clientId,
          clientSecret,
        },
        fetcher,
      );
      const check = {
        issuer: meta.issuer,
        clientId: auth.clientId,
        nonce: pending.nonce,
        now: now(),
      };
      let claims;
      try {
        claims = await verifyIdToken(idToken, {
          ...check,
          keys: await keysFor(meta),
        });
      } catch {
        // The provider may have rotated its keys: look once more.
        claims = await verifyIdToken(idToken, {
          ...check,
          keys: await keysFor(meta, true),
        });
      }
      const principal = principalFromClaims(claims, {
        rolesClaim: auth.rolesClaim,
        groupsClaim: auth.groupsClaim,
      });
      const session = await signToken({ ...principal }, secret, {
        purpose: 'session',
        ttlSeconds: auth.sessionHours * 3600,
        now: now(),
      });
      const headers = new Headers({
        location: safeReturnTo(pending.returnTo),
        ...NO_STORE,
      });
      headers.append(
        'set-cookie',
        serializeCookie(SESSION_COOKIE, session, {
          maxAgeSeconds: auth.sessionHours * 3600,
          secure,
        }),
      );
      headers.append(
        'set-cookie',
        serializeCookie(LOGIN_COOKIE, '', {
          maxAgeSeconds: 0,
          secure,
          path: '/api/auth',
        }),
      );
      return new Response(null, { status: 302, headers });
    } catch (error) {
      console.error('dockudos sign-in:', error);
      return fail(403, 'The sign-in could not be completed.');
    }
  }

  async function logout(request: Request): Promise<Response> {
    const ready = await setup(request);
    if (ready instanceof Response) return ready;
    const origin = request.headers.get('origin');
    if (
      origin &&
      origin !== new URL(request.url).origin &&
      origin !== ready.base
    )
      return fail(403, 'Sign-out must be requested from this site.');
    const headers = new Headers({
      location: safeReturnTo(new URL(request.url).searchParams.get('returnTo')),
      ...NO_STORE,
    });
    headers.append(
      'set-cookie',
      serializeCookie(SESSION_COOKIE, '', {
        maxAgeSeconds: 0,
        secure: ready.secure,
      }),
    );
    return new Response(null, { status: 303, headers });
  }

  async function session(request: Request): Promise<Response> {
    const ready = await setup(request);
    if (ready instanceof Response) return ready;
    const user = await readSession(request, ready.secret, now());
    if (!user) return fail(401, 'Not signed in.');
    return new Response(JSON.stringify({ user }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...NO_STORE,
      },
    });
  }

  return { login, callback, logout, session };
}
