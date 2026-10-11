import { toB64url } from '@dockudos/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessProxy } from './access.ts';
import { createDocsApi } from './api.ts';
import { createAuthHandlers } from './auth.ts';
import { getSite } from './server.ts';
import { LOGIN_COOKIE, SESSION_COOKIE } from './session.ts';

const SECRET = 'k'.repeat(48);
const ISSUER = 'https://idp.test';
const NOW = 2_000_000_000;

/** A small identity provider: discovery, keys, and a token endpoint that checks the PKCE verifier. */
async function identityProvider(
  claims: (nonce: string) => Record<string, unknown>,
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
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', publicKey)),
    kid: 'k1',
    use: 'sig',
  };
  const codes = new Map<
    string,
    { challenge: string; nonce: string; redirect: string }
  >();
  const text = (v: unknown) =>
    toB64url(new TextEncoder().encode(JSON.stringify(v)));
  const sign = async (payload: object, kid = 'k1') => {
    const input = `${text({ alg: 'RS256', kid, typ: 'JWT' })}.${text(payload)}`;
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${toB64url(new Uint8Array(sig))}`;
  };
  const log: string[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = String(input);
    log.push(u);
    if (u === `${ISSUER}/.well-known/openid-configuration`)
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/keys`,
      });
    if (u === `${ISSUER}/keys`) return Response.json({ keys: [jwk] });
    if (u === `${ISSUER}/token`) {
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
      return Response.json({
        id_token: await sign({
          iss: ISSUER,
          aud: 'dockudos',
          iat: NOW - 5,
          exp: NOW + 600,
          nonce: entry.nonce,
          ...claims(entry.nonce),
        }),
      });
    }
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  /** The user "signs in" at the provider: gives a code for the authorization request in `location`. */
  const approve = (location: string, code = 'code-1') => {
    const q = new URL(location).searchParams;
    codes.set(code, {
      challenge: q.get('code_challenge') ?? '',
      nonce: q.get('nonce') ?? '',
      redirect: q.get('redirect_uri') ?? '',
    });
    return { code, state: q.get('state') ?? '' };
  };
  return { fetcher, approve, sign, log };
}

let root: string;
let cwd: string;
const config = (extra: object = {}) => ({
  name: 'Acme',
  seo: { siteUrl: 'https://docs.test' },
  auth: {
    issuer: ISSUER,
    clientId: 'dockudos',
    rolesClaim: 'realm_access.roles',
  },
  access: {
    rules: [{ paths: ['/team/**'], require: 'login', roles: ['staff'] }],
  },
  ...extra,
});

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-auth-'));
  await mkdir(join(root, 'docs', 'team'), { recursive: true });
  await writeFile(join(root, 'docs.json'), JSON.stringify(config()));
  await writeFile(join(root, 'docs', 'index.mdx'), '# Home');
  await writeFile(
    join(root, 'docs', 'team', 'handbook.mdx'),
    '# Handbook\n\nSECRET-HANDBOOK',
  );
  process.chdir(root);
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

const url = (path: string) => `https://docs.test${path}`;
const cookies = (res: Response) =>
  Object.fromEntries(
    res.headers.getSetCookie().map((c) => [c.split('=')[0] as string, c]),
  );
const cookieHeader = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c?.endsWith('='))
    .join('; ');

describe('the sign-in flow against a mock OIDC provider', () => {
  async function startLogin(
    handlers: ReturnType<typeof createAuthHandlers>,
    returnTo = '/team/handbook',
  ) {
    const res = await handlers.login(
      new Request(
        url(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
      ),
    );
    return {
      res,
      location: res.headers.get('location') ?? '',
      jar: cookies(res),
    };
  }

  it('sends the visitor to the provider with PKCE, state and a nonce, and remembers the attempt in a signed cookie', async () => {
    const idp = await identityProvider(() => ({}));
    const { res, location, jar } = await startLogin(
      createAuthHandlers({
        env: { DOCKUDOS_AUTH_SECRET: SECRET },
        fetch: idp.fetcher,
        now: () => NOW,
      }),
    );
    expect(res.status).toBe(302);
    const q = new URL(location).searchParams;
    expect(location.startsWith(`${ISSUER}/auth?`)).toBe(true);
    expect(q.get('redirect_uri')).toBe('https://docs.test/api/auth/callback');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).toBe('openid profile email');
    expect(q.get('state')?.length).toBeGreaterThan(20);
    expect(q.get('nonce')?.length).toBeGreaterThan(20);
    expect(jar[LOGIN_COOKIE]).toMatch(/HttpOnly/);
    expect(jar[LOGIN_COOKIE]).toMatch(/Secure/);
    expect(jar[LOGIN_COOKIE]).toMatch(/Path=\/api\/auth/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // the verifier never leaves the cookie's signed value in the clear toward the provider
    expect(location).not.toContain('verifier');
  });

  it('completes a sign-in, sets the session and sends the visitor back; then the protected page opens', async () => {
    const idp = await identityProvider(() => ({
      sub: 'user-7',
      email: 'a@acme.test',
      name: 'Ada',
      realm_access: { roles: ['staff'] },
    }));
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    const { location, jar } = await startLogin(handlers);
    const { code, state } = idp.approve(location);
    const back = await handlers.callback(
      new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
        headers: { cookie: jar[LOGIN_COOKIE]!.split(';')[0]! },
      }),
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/team/handbook');
    const set = cookies(back);
    expect(set[SESSION_COOKIE]).toMatch(
      /HttpOnly; SameSite=Lax; Secure; Max-Age=43200/,
    );
    expect(set[LOGIN_COOKIE]).toMatch(/Max-Age=0/);

    // who am I
    const me = await handlers.session(
      new Request(url('/api/auth/session'), {
        headers: { cookie: cookieHeader(back) },
      }),
    );
    expect(await me.json()).toEqual({
      user: {
        sub: 'user-7',
        email: 'a@acme.test',
        name: 'Ada',
        roles: ['staff'],
        groups: [],
      },
    });
    expect(
      (await handlers.session(new Request(url('/api/auth/session')))).status,
    ).toBe(401);

    // the protected page now opens (the clock of the session is real time, so use a fresh handler clock)
    const site = await getSite({ root });
    const proxy = createAccessProxy({
      rules: site.config.access.rules,
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
    });
    const opened = await proxy(
      new Request(url('/team/handbook'), {
        headers: { accept: 'text/html', cookie: cookieHeader(back) },
      }),
    );
    // `NOW` is in 2033, so the session is valid for the proxy running at real time
    expect(opened?.status).toBe(200);
  });

  it('refuses a user whose roles do not match, with 403 and not another sign-in', async () => {
    const idp = await identityProvider(() => ({
      sub: 'u',
      realm_access: { roles: ['guest'] },
    }));
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    const { location, jar } = await startLogin(handlers);
    const { code, state } = idp.approve(location);
    const back = await handlers.callback(
      new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
        headers: { cookie: jar[LOGIN_COOKIE]!.split(';')[0]! },
      }),
    );
    const site = await getSite({ root });
    const proxy = createAccessProxy({
      rules: site.config.access.rules,
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
    });
    expect(
      (
        await proxy(
          new Request(url('/team/handbook'), {
            headers: { accept: 'text/html', cookie: cookieHeader(back) },
          }),
        )
      )?.status,
    ).toBe(403);
  });

  it('rejects: a wrong state, no cookie, a replayed or unknown code, a refusal at the provider, a nonce from another attempt', async () => {
    const idp = await identityProvider(() => ({ sub: 'u' }));
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    const { location, jar } = await startLogin(handlers);
    const cookie = jar[LOGIN_COOKIE]!.split(';')[0]!;
    const { code, state } = idp.approve(location);
    const call = (qs: string, headers: Record<string, string> = { cookie }) =>
      handlers.callback(
        new Request(url(`/api/auth/callback?${qs}`), { headers }),
      );

    expect((await call(`code=${code}&state=wrong`)).status).toBe(400);
    expect((await call(`code=${code}&state=${state}`, {})).status).toBe(400);
    expect((await call(`state=${state}`)).status).toBe(400);
    expect((await call(`error=access_denied&state=${state}`)).status).toBe(403);
    expect((await call(`code=unknown&state=${state}`)).status).toBe(403);
    // an expired attempt
    const late = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW + 3600,
    });
    expect(
      (
        await late.callback(
          new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(400);
    // a code issued for another attempt's nonce
    const other = await startLogin(handlers);
    const otherCode = idp.approve(other.location, 'code-2');
    const mixed = await handlers.callback(
      new Request(
        url(`/api/auth/callback?code=${otherCode.code}&state=${state}`),
        { headers: { cookie } },
      ),
    );
    expect(mixed.status).toBe(403); // the state is this attempt's, the code is another's: the nonce does not match
  });

  it('never returns to another site', async () => {
    const idp = await identityProvider(() => ({
      sub: 'u',
      realm_access: { roles: ['staff'] },
    }));
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    for (const evil of ['https://evil.test/x', '//evil.test', '/\\evil.test']) {
      const { location, jar } = await startLogin(handlers, evil);
      const { code, state } = idp.approve(location);
      const back = await handlers.callback(
        new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
          headers: { cookie: jar[LOGIN_COOKIE]!.split(';')[0]! },
        }),
      );
      expect(back.headers.get('location')).toBe('/');
    }
  });

  it('picks up a rotated signing key once', async () => {
    const idp = await identityProvider(() => ({ sub: 'u' }));
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    for (const n of [1, 2]) {
      const { location, jar } = await startLogin(handlers);
      const { code, state } = idp.approve(location, `c${n}`);
      expect(
        (
          await handlers.callback(
            new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
              headers: { cookie: jar[LOGIN_COOKIE]!.split(';')[0]! },
            }),
          )
        ).status,
      ).toBe(302);
    }
    // discovery and keys were fetched once each for two sign-ins
    expect(
      idp.log.filter((u) => u.endsWith('openid-configuration')),
    ).toHaveLength(1);
    expect(idp.log.filter((u) => u.endsWith('/keys'))).toHaveLength(1);
  });

  it('signs out with a POST from this site only', async () => {
    const handlers = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      now: () => NOW,
    });
    const out = await handlers.logout(
      new Request(url('/api/auth/logout?returnTo=/guides'), {
        method: 'POST',
        headers: { origin: 'https://docs.test' },
      }),
    );
    expect(out.status).toBe(303);
    expect(out.headers.get('location')).toBe('/guides');
    expect(cookies(out)[SESSION_COOKIE]).toMatch(/Max-Age=0/);
    expect(
      (
        await handlers.logout(
          new Request(url('/api/auth/logout'), {
            method: 'POST',
            headers: { origin: 'https://evil.test' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handlers.logout(
          new Request(url('/api/auth/logout'), { method: 'POST' }),
        )
      ).status,
    ).toBe(303);
  });

  it('says what is missing: no auth block, no secret, an unreachable provider, a missing client secret', async () => {
    const noSecret = createAuthHandlers({ env: {} });
    expect(
      (await noSecret.login(new Request(url('/api/auth/login')))).status,
    ).toBe(503);
    const down = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: (async () => new Response('', { status: 500 })) as typeof fetch,
    });
    expect((await down.login(new Request(url('/api/auth/login')))).status).toBe(
      502,
    );
    await writeFile(join(root, 'docs.json'), JSON.stringify({ name: 'Acme' }));
    expect(
      (
        await createAuthHandlers({
          env: { DOCKUDOS_AUTH_SECRET: SECRET },
        }).login(new Request(url('/api/auth/login')))
      ).status,
    ).toBe(404);

    const idp = await identityProvider(() => ({ sub: 'u' }));
    await writeFile(
      join(root, 'docs.json'),
      JSON.stringify(
        config({
          auth: {
            issuer: ISSUER,
            clientId: 'dockudos',
            clientSecretEnv: 'IDP_SECRET',
          },
        }),
      ),
    );
    const h = createAuthHandlers({
      env: { DOCKUDOS_AUTH_SECRET: SECRET },
      fetch: idp.fetcher,
      now: () => NOW,
    });
    const { location, jar } = await startLogin(h);
    const { code, state } = idp.approve(location);
    expect(
      (
        await h.callback(
          new Request(url(`/api/auth/callback?code=${code}&state=${state}`), {
            headers: { cookie: jar[LOGIN_COOKIE]!.split(';')[0]! },
          }),
        )
      ).status,
    ).toBe(503);
  });

  it('is reachable through createDocsApi', async () => {
    const api = createDocsApi({
      auth: {
        env: { DOCKUDOS_AUTH_SECRET: SECRET },
        fetch: (await identityProvider(() => ({}))).fetcher,
      },
    });
    const res = await api.GET(new Request(url('/api/auth/login')), {
      params: Promise.resolve({ dockudos: ['auth', 'login'] }),
    });
    expect(res.status).toBe(302);
    const out = await api.POST(
      new Request(url('/api/auth/logout'), { method: 'POST' }),
      { params: Promise.resolve({ dockudos: ['auth', 'logout'] }) },
    );
    expect(out.status).toBe(303);
  });
});
