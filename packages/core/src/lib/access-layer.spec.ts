import {
  OidcError,
  authorizationUrl,
  createPkce,
  discoverProvider,
  exchangeCode,
  verifyIdToken,
} from './oidc.ts';
import {
  claimList,
  decideLogin,
  principalFromClaims,
  safeReturnTo,
  type Principal,
} from './principal.ts';
import {
  readCookie,
  serializeCookie,
  signToken,
  toB64url,
  verifyToken,
} from './session.ts';
import { parseConfig } from './config.ts';
import {
  filterIndex,
  publicIndex,
  resolveScope,
  scopeFilter,
} from './index-filter.ts';
import type { ContentIndex } from './content-index.ts';

// Sign JWTs with WebCrypto, so no JWT library is needed.

type Alg = 'RS256' | 'ES256';

type Key = Parameters<typeof crypto.subtle.sign>[1];

export async function generateKeyPair(
  alg: Alg,
): Promise<{ privateKey: Key; publicKey: Key }> {
  return crypto.subtle.generateKey(
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as unknown as Promise<{ privateKey: Key; publicKey: Key }>;
}

export async function exportJWK(key: Key): Promise<Record<string, unknown>> {
  return crypto.subtle.exportKey('jwk', key as never) as unknown as Promise<
    Record<string, unknown>
  >;
}

const text = (v: unknown) =>
  toB64url(new TextEncoder().encode(JSON.stringify(v)));

export class SignJWT {
  constructor(
    private readonly claims: object,
    private readonly alg: Alg,
    private readonly kid: string,
  ) {}

  async sign(key: Key): Promise<string> {
    const input = `${text({ alg: this.alg, kid: this.kid, typ: 'JWT' })}.${text(this.claims)}`;
    const signature = await crypto.subtle.sign(
      this.alg === 'RS256'
        ? { name: 'RSASSA-PKCS1-v1_5' }
        : { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(input),
    );
    return `${input}.${toB64url(new Uint8Array(signature))}`;
  }
}

const alice: Principal = { sub: 'a', roles: ['editor'], groups: ['eng'] };

describe('decideLogin', () => {
  it('asks anonymous visitors to sign in', () => {
    expect(decideLogin({}, undefined)).toBe('sign-in');
    expect(decideLogin({ roles: ['x'] }, undefined)).toBe('sign-in');
  });
  it('lets any signed-in user through a rule that names no role or group', () => {
    expect(decideLogin({}, { sub: 'z', roles: [], groups: [] })).toBe('allow');
  });
  it('requires one of the roles or groups named, and denies otherwise', () => {
    expect(decideLogin({ roles: ['editor'] }, alice)).toBe('allow');
    expect(decideLogin({ roles: ['admin'] }, alice)).toBe('forbidden');
    expect(decideLogin({ groups: ['eng'] }, alice)).toBe('allow');
    expect(decideLogin({ groups: ['ops'] }, alice)).toBe('forbidden');
    expect(decideLogin({ roles: ['admin'], groups: ['eng'] }, alice)).toBe(
      'allow',
    );
    expect(decideLogin({ roles: ['Editor'] }, alice)).toBe('forbidden'); // case-sensitive
  });
});

describe('claims', () => {
  it('reads lists, single strings, dotted paths and namespaced names', () => {
    const claims = {
      roles: ['a', 'b', 3],
      group: 'solo',
      realm_access: { roles: ['r'] },
      'https://acme.com/roles': ['ns'],
    };
    expect(claimList(claims, 'roles')).toEqual(['a', 'b']);
    expect(claimList(claims, 'group')).toEqual(['solo']);
    expect(claimList(claims, 'realm_access.roles')).toEqual(['r']);
    expect(claimList(claims, 'https://acme.com/roles')).toEqual(['ns']);
    expect(claimList(claims, 'missing.deep')).toEqual([]);
    expect(claimList({ r: '' }, 'r')).toEqual([]);
    expect(claimList({ r: 5 }, 'r')).toEqual([]);
  });

  it('builds a principal and needs a sub', () => {
    expect(
      principalFromClaims({
        sub: 's',
        email: 'e@x.io',
        name: 'N',
        roles: ['a'],
        groups: 'g',
      }),
    ).toEqual({
      sub: 's',
      email: 'e@x.io',
      name: 'N',
      roles: ['a'],
      groups: ['g'],
    });
    expect(() => principalFromClaims({ email: 'x' })).toThrow(/sub/);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/guides/a?x=1', '/guides/a?x=1'],
    ['/', '/'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['/\\evil.com', '/'],
    ['/a\nb', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [null, '/'],
    ['/' + 'a'.repeat(3000), '/'],
    ['/%2F%2Fevil.com', '/%2F%2Fevil.com'],
  ])('%s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

const SECRET = 'x'.repeat(40);

describe('signed tokens', () => {
  it('round-trips data', async () => {
    const token = await signToken({ sub: 'a', roles: ['x'] }, SECRET, {
      purpose: 'session',
      ttlSeconds: 60,
      now: 1000,
    });
    expect(
      await verifyToken(token, SECRET, { purpose: 'session', now: 1030 }),
    ).toEqual({ sub: 'a', roles: ['x'] });
  });

  it('refuses expiry, other purpose, other secret, tampering and junk', async () => {
    const token = await signToken({ sub: 'a' }, SECRET, {
      purpose: 'session',
      ttlSeconds: 60,
      now: 1000,
    });
    expect(
      await verifyToken(token, SECRET, { purpose: 'session', now: 1060 }),
    ).toBeUndefined();
    expect(
      await verifyToken(token, SECRET, { purpose: 'login', now: 1001 }),
    ).toBeUndefined();
    expect(
      await verifyToken(token, 'y'.repeat(40), {
        purpose: 'session',
        now: 1001,
      }),
    ).toBeUndefined();
    const [body, sig] = token.split('.') as [string, string];
    const forged = btoa(
      JSON.stringify({ sub: 'admin', _p: 'session', _x: 9999999999 }),
    ).replace(/=+$/, '');
    expect(
      await verifyToken(`${forged}.${sig}`, SECRET, {
        purpose: 'session',
        now: 1001,
      }),
    ).toBeUndefined();
    expect(
      await verifyToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, {
        purpose: 'session',
        now: 1001,
      }),
    ).toBeUndefined();
    for (const junk of [
      '',
      'a',
      'a.b.c',
      '!!.!!',
      undefined,
      null,
      'a'.repeat(5000),
    ])
      expect(
        await verifyToken(junk as string, SECRET, {
          purpose: 'session',
          now: 1,
        }),
      ).toBeUndefined();
  });

  it('refuses a short secret and an oversized value', async () => {
    await expect(
      signToken({}, 'short', { purpose: 'p', ttlSeconds: 1 }),
    ).rejects.toThrow(/at least 32/);
    await expect(
      signToken({ big: 'x'.repeat(5000) }, SECRET, {
        purpose: 'p',
        ttlSeconds: 1,
      }),
    ).rejects.toThrow(/too large/);
    expect(await verifyToken('a.b', 'short', { purpose: 'p' })).toBeUndefined();
  });
});

describe('cookies', () => {
  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; dk=tok.en; b=2', 'dk')).toBe('tok.en');
    expect(readCookie('a=1', 'dk')).toBeUndefined();
    expect(readCookie(null, 'dk')).toBeUndefined();
    expect(readCookie('xdk=1', 'dk')).toBeUndefined();
  });
  it('writes secure, http-only cookies', () => {
    expect(serializeCookie('dk', 'v', { maxAgeSeconds: 60.9 })).toBe(
      'dk=v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60',
    );
    expect(
      serializeCookie('dk', '', {
        secure: false,
        maxAgeSeconds: -5,
        sameSite: 'Strict',
        path: '/x',
      }),
    ).toBe('dk=; Path=/x; HttpOnly; SameSite=Strict; Max-Age=0');
  });
});

describe('OIDC', () => {
  const issuer = 'https://idp.example.com';
  const meta = {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/keys`,
  };
  const provider = {
    issuer,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    jwksUri: meta.jwks_uri,
  };
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body)));

  it('discovers a provider and checks its issuer and endpoints', async () => {
    const f = ((url: string) => {
      expect(url).toBe(`${issuer}/.well-known/openid-configuration`);
      return ok(meta);
    }) as unknown as typeof fetch;
    await expect(discoverProvider(issuer, f)).resolves.toEqual(provider);
    await expect(discoverProvider(`${issuer}/`, f)).resolves.toEqual(provider);
    await expect(
      discoverProvider('https://other.example.com', (() =>
        ok(meta)) as unknown as typeof fetch),
    ).rejects.toThrow(/issuer/);
    await expect(
      discoverProvider(issuer, (() =>
        ok({ ...meta, token_endpoint: 'ftp://x' })) as unknown as typeof fetch),
    ).rejects.toThrow(/https endpoints/);
    await expect(
      discoverProvider(issuer, (() =>
        Promise.resolve(
          new Response('no', { status: 500 }),
        )) as unknown as typeof fetch),
    ).rejects.toThrow(/500/);
  });

  it('builds the authorization URL with PKCE, state and nonce', async () => {
    const pkce = await createPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(
      authorizationUrl(provider, {
        clientId: 'c',
        redirectUri: 'https://d.io/cb',
        scopes: ['openid', 'email'],
        state: 's',
        nonce: 'n',
        challenge: pkce.challenge,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'https://d.io/cb',
      scope: 'openid email',
      state: 's',
      nonce: 'n',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code, sending the verifier and (when set) the secret', async () => {
    let sent: URLSearchParams | undefined;
    const f = ((_u: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return ok({ id_token: 'tok' });
    }) as unknown as typeof fetch;
    await expect(
      exchangeCode(
        provider,
        {
          code: 'c1',
          verifier: 'v',
          redirectUri: 'r',
          clientId: 'id',
          clientSecret: 'sec',
        },
        f,
      ),
    ).resolves.toBe('tok');
    expect(Object.fromEntries(sent ?? [])).toMatchObject({
      code: 'c1',
      code_verifier: 'v',
      client_secret: 'sec',
      grant_type: 'authorization_code',
    });
    await exchangeCode(
      provider,
      { code: 'c1', verifier: 'v', redirectUri: 'r', clientId: 'id' },
      f,
    );
    expect(sent?.has('client_secret')).toBe(false);
    await expect(
      exchangeCode(
        provider,
        { code: 'c', verifier: 'v', redirectUri: 'r', clientId: 'id' },
        (() => ok({})) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/no ID token/);
    await expect(
      exchangeCode(
        provider,
        { code: 'c', verifier: 'v', redirectUri: 'r', clientId: 'id' },
        (() =>
          Promise.resolve(
            new Response('', { status: 400 }),
          )) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/refused/);
  });

  describe('verifyIdToken', () => {
    const now = 2_000_000_000;
    const base = {
      iss: issuer,
      aud: 'client',
      sub: 'u1',
      nonce: 'N',
      exp: now + 600,
      iat: now - 5,
    };
    const check = { issuer, clientId: 'client', nonce: 'N', now };

    it('accepts a good token and returns its claims', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', use: 'sig' };
      const token = await new SignJWT(base, 'RS256', 'k1').sign(privateKey);
      await expect(
        verifyIdToken(token, { ...check, keys: [jwk] }),
      ).resolves.toMatchObject({ sub: 'u1' });
    });

    it('accepts ES256 too', async () => {
      const { privateKey, publicKey } = await generateKeyPair('ES256');
      const jwk = { ...(await exportJWK(publicKey)), kid: 'e1' };
      const token = await new SignJWT(base, 'ES256', 'e1').sign(privateKey);
      await expect(
        verifyIdToken(token, { ...check, keys: [jwk] }),
      ).resolves.toMatchObject({ sub: 'u1' });
    });

    it('refuses every kind of bad token', async () => {
      const a = await generateKeyPair('RS256');
      const b = await generateKeyPair('RS256');
      const keys = [{ ...(await exportJWK(a.publicKey)), kid: 'k1' }];
      const sign = (
        claims: object,
        key = a.privateKey,
        kid = 'k1',
        alg: 'RS256' = 'RS256',
      ) => new SignJWT(claims, alg, kid).sign(key);
      const bad = async (token: string, pattern: RegExp, k = keys) =>
        expect(verifyIdToken(token, { ...check, keys: k })).rejects.toThrow(
          pattern,
        );

      await bad(await sign(base, b.privateKey), /signature/); // signed by another key
      await bad(await sign({ ...base, iss: 'https://evil.example' }), /issuer/);
      await bad(
        await sign({ ...base, aud: 'someone-else' }),
        /another application/,
      );
      await bad(
        await sign({ ...base, aud: ['client', 'other'] }),
        /another application/,
      );
      await bad(await sign({ ...base, exp: now - 120 }), /expired/);
      await bad(await sign({ ...base, exp: undefined }), /expired/);
      await bad(await sign({ ...base, iat: now + 3600 }), /future/);
      await bad(await sign({ ...base, nonce: 'other' }), /does not match/);
      await bad(await sign(base, a.privateKey, 'unknown'), /does not publish/);
      await bad(await sign(base), /does not publish/, []);
      await bad('a.b', /malformed/);
      await bad('!.!.!', /malformed/);
      // alg: none and HS256 are refused outright
      const header = (alg: string) =>
        btoa(JSON.stringify({ alg, typ: 'JWT' })).replace(/=+$/, '');
      const payload = btoa(JSON.stringify(base)).replace(/=+$/, '');
      await bad(`${header('none')}.${payload}.`, /unsupported algorithm/);
      await bad(`${header('HS256')}.${payload}.c2ln`, /unsupported algorithm/);
    });

    it('allows a few seconds of clock drift', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const keys = [{ ...(await exportJWK(publicKey)), kid: 'k' }];
      const token = await new SignJWT(
        { ...base, exp: now - 30 },
        'RS256',
        'k',
      ).sign(privateKey);
      await expect(
        verifyIdToken(token, { ...check, keys }),
      ).resolves.toBeDefined();
      expect(OidcError.name).toBe('OidcError');
    });
  });
});

describe('index filters', () => {
  const chunk = (id: string, pagePath: string) =>
    ({
      id,
      pagePath,
      text: id,
      headingPath: [],
      anchor: undefined,
    }) as unknown as ContentIndex['chunks'][number];
  const page = (path: string, locale?: string, version?: string) =>
    ({
      path,
      title: path,
      headings: [],
      hash: path,
      ...(locale && { locale }),
      ...(version && { version }),
    }) as ContentIndex['pages'][number];
  const index: ContentIndex = {
    version: 1,
    builtAt: '',
    pages: [
      page('/a', 'en', 'v2'),
      page('/fr/a', 'fr', 'v2'),
      page('/v1/a', 'en', 'v1'),
      page('/private', 'en', 'v2'),
    ],
    chunks: [
      chunk('c1', '/a'),
      chunk('c2', '/fr/a'),
      chunk('c3', '/v1/a'),
      chunk('c4', '/private'),
    ],
  };
  const config = parseConfig({
    name: 'X',
    access: { rules: [{ paths: ['/private'], require: 'deny' }] },
  });

  it('removes protected pages and their chunks from the public form', () => {
    const open = publicIndex(index, config);
    expect(open.pages.map((p) => p.path)).toEqual(['/a', '/fr/a', '/v1/a']);
    expect(open.chunks.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(publicIndex(index, parseConfig({ name: 'X' }))).toBe(index);
    expect(filterIndex(index, () => false)).toMatchObject({
      pages: [],
      chunks: [],
    });
  });

  it('keeps retrieval inside one version and language, and out of pages the reader may not see', () => {
    const only = (scope: object, canSee?: (p: string) => boolean) => {
      const f = scopeFilter(scope, canSee);
      return index.chunks
        .filter((c) =>
          f(c, index.pages.find((p) => p.path === c.pagePath) as never),
        )
        .map((c) => c.id);
    };
    expect(only({ locale: 'en', version: 'v2' })).toEqual(['c1', 'c4']);
    expect(
      only({ locale: 'en', version: 'v2' }, (p) => p !== '/private'),
    ).toEqual(['c1']);
    expect(only({ locale: 'fr', version: 'v2' })).toEqual(['c2']);
    expect(only({ locale: 'en', version: 'v1' })).toEqual(['c3']);
    expect(only({ version: 'v2' })).toEqual(['c1', 'c2', 'c4']);
    expect(only({})).toHaveLength(4);
    // a page without the dimension is not let in when the site has it
    const f = scopeFilter({ locale: 'en' });
    expect(f(index.chunks[0] as never, page('/x'))).toBe(false);
  });

  it('resolves the scope of a request against the config', () => {
    const c = parseConfig({
      name: 'X',
      versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
      i18n: { default: 'en', locales: ['en', 'fr'] },
    });
    expect(resolveScope(c, {})).toEqual({
      scope: { version: 'v2', locale: 'en' },
    });
    expect(resolveScope(c, { version: 'v1', locale: 'fr' })).toEqual({
      scope: { version: 'v1', locale: 'fr' },
    });
    expect(resolveScope(c, { version: 'v9' }).error).toMatch(/Unknown version/);
    expect(resolveScope(c, { locale: 'xx' }).error).toMatch(/Unknown language/);
    expect(
      resolveScope(parseConfig({ name: 'X' }), { version: 'v9', locale: 'xx' }),
    ).toEqual({ scope: {} });
  });
});
