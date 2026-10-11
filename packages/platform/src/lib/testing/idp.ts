import { webcrypto } from 'node:crypto';
import { toB64url } from '@dockudos/core';

/** A small OpenID Connect provider for tests: discovery, keys, and a token endpoint that checks PKCE. */
export async function createTestIdp(
  issuer = 'https://idp.test',
  clientId = 'dockudos',
) {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as webcrypto.CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', publicKey)),
    kid: 'k1',
    use: 'sig',
  };
  const codes = new Map<
    string,
    {
      challenge: string;
      nonce: string;
      redirect: string;
      claims: Record<string, unknown>;
    }
  >();
  const enc = (v: unknown) =>
    toB64url(new TextEncoder().encode(JSON.stringify(v)));
  const sign = async (payload: object) => {
    const input = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc(payload)}`;
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${toB64url(new Uint8Array(sig))}`;
  };
  let now = 2_000_000_000;
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = String(input);
    if (u === `${issuer}/.well-known/openid-configuration`)
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
      });
    if (u === `${issuer}/keys`) return Response.json({ keys: [jwk] });
    if (u === `${issuer}/token`) {
      const form = init?.body as URLSearchParams;
      const entry = codes.get(form.get('code') ?? '');
      if (!entry || form.get('redirect_uri') !== entry.redirect)
        return new Response('bad', { status: 400 });
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(form.get('code_verifier') ?? ''),
      );
      if (toB64url(new Uint8Array(digest)) !== entry.challenge)
        return new Response('pkce', { status: 400 });
      codes.delete(form.get('code') ?? '');
      return Response.json({
        id_token: await sign({
          iss: issuer,
          aud: clientId,
          iat: now - 5,
          exp: now + 600,
          nonce: entry.nonce,
          ...entry.claims,
        }),
      });
    }
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  return {
    fetcher,
    /** Seconds since 1970 that the provider's tokens are stamped with. Pass the same to the platform's clock. */
    get now() {
      return now;
    },
    set now(v: number) {
      now = v;
    },
    /** The person signs in at the provider. Returns the `code` and `state` the redirect back would carry. */
    approve(
      location: string,
      claims: Record<string, unknown>,
      code = `code-${codes.size + 1}`,
    ) {
      const q = new URL(location).searchParams;
      codes.set(code, {
        challenge: q.get('code_challenge') ?? '',
        nonce: q.get('nonce') ?? '',
        redirect: q.get('redirect_uri') ?? '',
        claims,
      });
      return { code, state: q.get('state') ?? '' };
    },
  };
}
