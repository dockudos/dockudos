import { fromB64url, toB64url } from './session.ts';

/** The parts of an OpenID Connect provider's discovery document that the sign-in flow uses. */
export interface OidcProvider {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

type Fetch = typeof fetch;

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

const isUrl = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))
    );
  } catch {
    return false;
  }
};

/** Fetch `/.well-known/openid-configuration`, and check the provider says it is the issuer we asked. */
export async function discoverProvider(
  issuer: string,
  fetcher: Fetch = fetch,
): Promise<OidcProvider> {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const res = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!res.ok)
    throw new OidcError(
      `The sign-in provider answered ${res.status} for ${url}.`,
    );
  const doc = (await res.json()) as Record<string, unknown>;
  if (doc['issuer'] !== issuer.replace(/\/+$/, '') && doc['issuer'] !== issuer)
    throw new OidcError(
      `The provider at ${issuer} says its issuer is ${String(doc['issuer'])}. Use that exact value as auth.issuer.`,
    );
  const { authorization_endpoint: a, token_endpoint: t, jwks_uri: j } = doc;
  if (!isUrl(a) || !isUrl(t) || !isUrl(j))
    throw new OidcError(
      "The provider's configuration is missing https endpoints for sign-in, tokens or keys.",
    );
  return {
    issuer: doc['issuer'] as string,
    authorizationEndpoint: a,
    tokenEndpoint: t,
    jwksUri: j,
  };
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** A PKCE pair (S256). */
export async function createPkce(): Promise<Pkce> {
  const verifier = randomString(48);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: toB64url(new Uint8Array(digest)) };
}

/** Unguessable URL-safe text from `bytes` random bytes. */
export function randomString(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  nonce: string;
  challenge: string;
}

export function authorizationUrl(
  provider: OidcProvider,
  p: AuthorizeParams,
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes.join(' '));
  url.searchParams.set('state', p.state);
  url.searchParams.set('nonce', p.nonce);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface CodeExchange {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}

/** Trade the code from the redirect for tokens. Returns the ID token. */
export async function exchangeCode(
  provider: OidcProvider,
  { code, verifier, redirectUri, clientId, clientSecret }: CodeExchange,
  fetcher: Fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetcher(provider.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  if (!res.ok)
    throw new OidcError(
      `The provider refused the sign-in code (${res.status}).`,
    );
  const tokens = (await res.json()) as { id_token?: unknown };
  if (typeof tokens.id_token !== 'string')
    throw new OidcError(
      'The provider sent no ID token. Check that the "openid" scope is allowed.',
    );
  return tokens.id_token;
}

/** A key of the provider's JSON Web Key set. */
export interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  [field: string]: unknown;
}

export async function fetchJwks(
  uri: string,
  fetcher: Fetch = fetch,
): Promise<Jwk[]> {
  const res = await fetcher(uri, { headers: { accept: 'application/json' } });
  if (!res.ok)
    throw new OidcError(
      `Could not read the provider's signing keys (${res.status}).`,
    );
  const body = (await res.json()) as { keys?: Jwk[] };
  return Array.isArray(body.keys) ? body.keys : [];
}

const ALGS = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
    kty: 'RSA',
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
    kty: 'EC',
  },
} as const;

export interface IdTokenChecks {
  keys: readonly Jwk[];
  issuer: string;
  clientId: string;
  nonce: string;
  /** Seconds since 1970. Default: now. */
  now?: number;
  /** Seconds of clock difference to forgive. Default 60. */
  skew?: number;
}

const json = (part: string): Record<string, unknown> | undefined => {
  const bytes = fromB64url(part);
  if (!bytes) return undefined;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Verify an ID token and return its claims: the signature (RS256 or ES256 only, with a key of the provider's
 * set, so `none` and symmetric algorithms are refused), then `iss`, `aud`, `exp`, `iat` and the `nonce`.
 */
export async function verifyIdToken(
  token: string,
  {
    keys,
    issuer,
    clientId,
    nonce,
    now = Math.floor(Date.now() / 1000),
    skew = 60,
  }: IdTokenChecks,
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('The ID token is malformed.');
  const [h, p, s] = parts as [string, string, string];
  const header = json(h);
  const claims = json(p);
  const signature = fromB64url(s);
  if (!header || !claims || !signature)
    throw new OidcError('The ID token is malformed.');

  const alg = header['alg'];
  if (alg !== 'RS256' && alg !== 'ES256')
    throw new OidcError(
      `The ID token uses an unsupported algorithm (${String(alg)}).`,
    );
  const spec = ALGS[alg];
  const kid = header['kid'];
  const candidates = keys.filter(
    (k) =>
      k.kty === spec.kty &&
      (k.use === undefined || k.use === 'sig') &&
      (!kid || k.kid === kid) &&
      (!k.alg || k.alg === alg),
  );
  if (candidates.length === 0)
    throw new OidcError(
      'The ID token was signed with a key the provider does not publish.',
    );

  let ok = false;
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk as never,
        spec.import,
        false,
        ['verify'],
      );
      if (
        await crypto.subtle.verify(
          spec.verify,
          key,
          signature,
          new TextEncoder().encode(`${h}.${p}`),
        )
      ) {
        ok = true;
        break;
      }
    } catch {
      /* a key that does not fit: try the next */
    }
  }
  if (!ok) throw new OidcError("The ID token's signature is not valid.");

  const aud = claims['aud'];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (claims['iss'] !== issuer && claims['iss'] !== issuer.replace(/\/+$/, ''))
    throw new OidcError('The ID token is from another issuer.');
  if (!audiences.includes(clientId))
    throw new OidcError('The ID token is for another application.');
  if (audiences.length > 1 && claims['azp'] !== clientId)
    throw new OidcError('The ID token is for another application.');
  const exp = claims['exp'];
  if (typeof exp !== 'number' || exp + skew < now)
    throw new OidcError('The ID token has expired.');
  const iat = claims['iat'];
  if (typeof iat === 'number' && iat - skew > now)
    throw new OidcError('The ID token is from the future.');
  if (claims['nonce'] !== nonce)
    throw new OidcError('The ID token does not match this sign-in attempt.');
  return claims;
}
