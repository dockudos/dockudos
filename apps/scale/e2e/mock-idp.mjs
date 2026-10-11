// A tiny OpenID Connect provider for the end-to-end tests: discovery, signing keys, an authorization endpoint that
// approves at once, and a token endpoint that checks the PKCE verifier. Which user signs in is set with
// `GET /__user?sub=ada&roles=staff,admin`. Not for anything but tests.
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import { createServer } from 'node:http';

const port = 4311;
const issuer = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'e2e',
  use: 'sig',
  alg: 'RS256',
};
const b64 = (v) =>
  Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString(
    'base64url',
  );

let user = { sub: 'ada', roles: ['staff'], name: 'Ada' };
const codes = new Map();

createServer((req, res) => {
  const url = new URL(req.url, issuer);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/.well-known/openid-configuration')
    return json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/keys`,
    });
  if (url.pathname === '/keys') return json({ keys: [jwk] });
  if (url.pathname === '/__user') {
    user = {
      sub: url.searchParams.get('sub') ?? 'ada',
      name: url.searchParams.get('sub') ?? 'ada',
      roles: (url.searchParams.get('roles') ?? '').split(',').filter(Boolean),
    };
    return json(user);
  }
  if (url.pathname === '/auth') {
    const code = randomUUID();
    codes.set(code, {
      challenge: url.searchParams.get('code_challenge'),
      nonce: url.searchParams.get('nonce'),
      redirect: url.searchParams.get('redirect_uri'),
      user,
    });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const form = new URLSearchParams(data);
      const entry = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (
        !entry ||
        entry.challenge !== challenge ||
        entry.redirect !== form.get('redirect_uri') ||
        form.get('client_secret') !== 'e2e-secret'
      )
        return json({ error: 'invalid_grant' }, 400);
      const now = Math.floor(Date.now() / 1000);
      const head = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' });
      const body = b64({
        iss: issuer,
        aud: 'scale',
        sub: entry.user.sub,
        name: entry.user.name,
        roles: entry.user.roles,
        nonce: entry.nonce,
        iat: now,
        exp: now + 600,
      });
      const sig = createSign('RSA-SHA256')
        .update(`${head}.${body}`)
        .sign(privateKey)
        .toString('base64url');
      json({ id_token: `${head}.${body}.${sig}`, token_type: 'Bearer' });
    });
    return;
  }
  json({ error: 'not found' }, 404);
}).listen(port, '127.0.0.1');
