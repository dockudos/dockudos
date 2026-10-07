import {
  type AccessRule,
  bearerToken,
  checkBasic,
  checkToken,
  findAccessRule,
  matchesPattern,
  normalizePath,
  parseBasicAuth,
  parseCredentials,
  parseTokens,
  safeEqual,
} from './access.ts';

const basic = (user: string, password: string) =>
  `Basic ${btoa(`${user}:${password}`)}`;
const rule = (
  paths: string[],
  require: AccessRule['require'] = 'basic',
): AccessRule => ({ paths, require });

describe('normalizePath', () => {
  it('drops repeated and trailing slashes, and decodes escapes', () => {
    expect(normalizePath('/a//b/')).toBe('/a/b');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/%70rivate')).toBe('/private');
  });

  it('reports a broken escape as unreadable', () => {
    expect(normalizePath('/a/%E0%A4%A')).toBeUndefined();
  });
});

describe('matchesPattern', () => {
  it.each([
    ['/print', '/print', true],
    ['/print', '/print/', true],
    ['/print', '/print/x', false],
    ['/print', '/printer', false],
    ['/team/*', '/team/a', true],
    ['/team/*', '/team', false],
    ['/team/*', '/team/a/b', false],
    ['/team/**', '/team', true],
    ['/team/**', '/team/a/b/c', true],
    ['/team/**', '/teams', false],
    ['/**', '/', true],
    ['/**', '/anything/at/all', true],
    ['/a/*/c', '/a/b/c', true],
    ['/a/*/c', '/a/b/d', false],
    ['/', '/', true],
    ['/', '/a', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });

  it('is not fooled by encoded or doubled slashes', () => {
    expect(matchesPattern('/private/**', '/%70rivate/secret')).toBe(true);
    expect(matchesPattern('/private/**', '//private//secret')).toBe(true);
    expect(matchesPattern('/private/**', '/private%2Fsecret')).toBe(true);
    expect(matchesPattern('/private/**', '/public/../private/x')).toBe(false); // the URL parser resolves dots before this runs
  });

  it('is case sensitive, as the routes are', () => {
    expect(matchesPattern('/private/**', '/Private/x')).toBe(false);
  });
});

describe('findAccessRule', () => {
  const rules = [
    rule(['/team/public'], 'deny'),
    rule(['/team/**']),
    rule(['/print'], 'token'),
  ];

  it('uses the first rule that covers the path', () => {
    expect(findAccessRule(rules, '/team/public')?.require).toBe('deny');
    expect(findAccessRule(rules, '/team/x')?.require).toBe('basic');
    expect(findAccessRule(rules, '/print')?.require).toBe('token');
  });

  it('finds nothing for an unprotected path', () => {
    expect(findAccessRule(rules, '/guides/a')).toBeUndefined();
    expect(findAccessRule([], '/x')).toBeUndefined();
  });

  it('protects a path it cannot read instead of letting it through', () => {
    expect(findAccessRule(rules, '/%E0%A4%A')).toBe(rules[0]);
  });
});

describe('Basic auth', () => {
  it('parses a header, including a colon in the password and unicode', () => {
    expect(parseBasicAuth(basic('ada', 'p:ss'))).toEqual({
      user: 'ada',
      password: 'p:ss',
    });
    expect(
      parseBasicAuth(
        `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('zoë:pässword')))}`,
      ),
    ).toEqual({ user: 'zoë', password: 'pässword' });
  });

  it.each([
    null,
    undefined,
    '',
    'Bearer abc',
    'Basic',
    'Basic !!!',
    `Basic ${btoa('nocolon')}`,
  ])('rejects %j', (header) => {
    expect(parseBasicAuth(header)).toBeUndefined();
  });

  it('parses credentials from a variable, ignoring malformed entries', () => {
    expect(parseCredentials('ada:one, bob:two\ncarol:thr:ee')).toEqual([
      { user: 'ada', password: 'one' },
      { user: 'bob', password: 'two' },
      { user: 'carol', password: 'thr:ee' },
    ]);
    expect(parseCredentials('nocolon, :nouser, nopass:, ')).toEqual([]);
    expect(parseCredentials(undefined)).toEqual([]);
  });

  it('accepts only an exact user and password pair', () => {
    const creds = parseCredentials('ada:one,bob:two');
    expect(checkBasic(basic('ada', 'one'), creds)).toBe(true);
    expect(checkBasic(basic('bob', 'two'), creds)).toBe(true);
    expect(checkBasic(basic('ada', 'two'), creds)).toBe(false);
    expect(checkBasic(basic('ada', ''), creds)).toBe(false);
    expect(checkBasic(basic('', ''), creds)).toBe(false);
    expect(checkBasic(null, creds)).toBe(false);
    expect(checkBasic(basic('ada', 'one'), [])).toBe(false);
  });
});

describe('tokens', () => {
  it('reads a bearer token and checks it against the list', () => {
    expect(bearerToken('Bearer abc123xyz')).toBe('abc123xyz');
    expect(bearerToken('bearer  t ')).toBe('t');
    expect(bearerToken('Basic x')).toBeUndefined();
    const tokens = parseTokens('first-token-1, second-token-2');
    expect(checkToken('second-token-2', tokens)).toBe(true);
    expect(checkToken('second-token', tokens)).toBe(false);
    expect(checkToken(undefined, tokens)).toBe(false);
    expect(checkToken('anything', [])).toBe(false);
  });

  it('ignores tokens that are too short to be safe', () => {
    expect(parseTokens('short, long-enough-token')).toEqual([
      'long-enough-token',
    ]);
  });
});

describe('safeEqual', () => {
  it('compares exactly', () => {
    expect(safeEqual('same', 'same')).toBe(true);
    expect(safeEqual('same', 'sama')).toBe(false);
    expect(safeEqual('same', 'same!')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
