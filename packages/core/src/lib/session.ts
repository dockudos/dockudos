// Types come from the platform's WebCrypto, so this file runs in Node, edge runtimes and browsers alike.
type CryptoKey = Parameters<typeof crypto.subtle.sign>[1];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/** Decode base64url. Returns `undefined` for anything that is not base64url. */
export function fromB64url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(
      atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

export const toB64url = b64url;

/** Shortest secret `DOCKUDOS_AUTH_SECRET` may be. */
export const MIN_SECRET_LENGTH = 32;

/** Largest signed value accepted: cookies are limited to about 4 KB. */
export const MAX_TOKEN_LENGTH = 4000;

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

async function hmacKey(
  secret: string,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  if (secret.length < MIN_SECRET_LENGTH)
    throw new SessionError(
      `DOCKUDOS_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -base64 48`,
    );
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export interface SignOptions {
  /** What the token is for. A token made for one purpose is refused for another. */
  purpose: string;
  ttlSeconds: number;
  /** Seconds since 1970. Default: now. */
  now?: number;
}

/**
 * Sign a small JSON value: `payload.signature`, HMAC-SHA-256. The expiry and purpose are inside the signed part.
 * This is not encryption: put nothing in it that the visitor should not see.
 */
export async function signToken(
  data: Record<string, unknown>,
  secret: string,
  { purpose, ttlSeconds, now = Math.floor(Date.now() / 1000) }: SignOptions,
): Promise<string> {
  const body = b64url(
    encoder.encode(
      JSON.stringify({ ...data, _p: purpose, _x: now + Math.ceil(ttlSeconds) }),
    ),
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, 'sign'),
    encoder.encode(body),
  );
  const token = `${body}.${b64url(new Uint8Array(sig))}`;
  if (token.length > MAX_TOKEN_LENGTH)
    throw new SessionError('The value is too large for a cookie.');
  return token;
}

/** Check a token's signature, purpose and expiry. Returns the data, or `undefined` for any failure. */
export async function verifyToken<T extends Record<string, unknown>>(
  token: string | null | undefined,
  secret: string,
  {
    purpose,
    now = Math.floor(Date.now() / 1000),
  }: Pick<SignOptions, 'purpose' | 'now'>,
): Promise<T | undefined> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return undefined;
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [body, sig] = parts as [string, string];
  const given = fromB64url(sig);
  const payload = fromB64url(body);
  if (!given || !payload) return undefined;
  let valid = false;
  try {
    // `verify` compares in constant time.
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      given,
      encoder.encode(body),
    );
  } catch {
    return undefined;
  }
  if (!valid) return undefined;
  try {
    const data = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (data['_p'] !== purpose) return undefined;
    if (typeof data['_x'] !== 'number' || data['_x'] <= now) return undefined;
    const { _p, _x, ...rest } = data;
    void _p;
    void _x;
    return rest as T;
  } catch {
    return undefined;
  }
}

/** Read one cookie from a `Cookie` header. */
export function readCookie(
  header: string | null | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return part.slice(eq + 1).trim();
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  /** Default `Lax`: the sign-in redirect back from the provider is a top-level navigation. */
  sameSite?: 'Lax' | 'Strict';
  /** Path the cookie is sent to. Default `/`. */
  path?: string;
  secure?: boolean;
}

/** A `Set-Cookie` value: HttpOnly always, Secure unless told otherwise (plain-http development). */
export function serializeCookie(
  name: string,
  value: string,
  o: CookieOptions = {},
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${o.path ?? '/'}`,
    'HttpOnly',
    `SameSite=${o.sameSite ?? 'Lax'}`,
  ];
  if (o.secure !== false) parts.push('Secure');
  if (o.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`);
  return parts.join('; ');
}
