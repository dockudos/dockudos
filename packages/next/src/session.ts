import { type Principal, readCookie, verifyToken } from '@dockudos/core';

/** The cookie that holds the signed-in user. */
export const SESSION_COOKIE = 'dockudos_session';
/** Holds the state of a sign-in in progress (state, nonce, PKCE verifier, where to return). */
export const LOGIN_COOKIE = 'dockudos_login';

/** Where people sign in. */
export const LOGIN_PATH = '/api/auth/login';
export const CALLBACK_PATH = '/api/auth/callback';
export const LOGOUT_PATH = '/api/auth/logout';

type Env = Record<string, string | undefined>;

/** The secret that signs sessions. Returns `undefined` when it is not set or too short. */
export function authSecret(env: Env = process.env): string | undefined {
  const secret = env['DOCKUDOS_AUTH_SECRET'];
  return secret && secret.length >= 32 ? secret : undefined;
}

/** The signed-in user of a request, or `undefined` for a visitor with no valid session. */
export async function readSession(
  request: Request,
  secret: string,
  now?: number,
): Promise<Principal | undefined> {
  const data = await verifyToken<Record<string, unknown>>(
    readCookie(request.headers.get('cookie'), SESSION_COOKIE),
    secret,
    { purpose: 'session', now },
  );
  if (!data || typeof data['sub'] !== 'string') return undefined;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    sub: data['sub'],
    ...(typeof data['email'] === 'string' && { email: data['email'] }),
    ...(typeof data['name'] === 'string' && { name: data['name'] }),
    roles: list(data['roles']),
    groups: list(data['groups']),
  };
}
