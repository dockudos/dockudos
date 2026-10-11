import { describe, expect, it, vi } from 'vitest';
import {
  createSafeFetch,
  isPrivateAddress,
  UnsafeUrlError,
} from './safe-fetch.ts';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '[::1]',
    'nope',
  ])('%s is private', (a) => expect(isPrivateAddress(a)).toBe(true));
  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s is public', (a) => expect(isPrivateAddress(a)).toBe(false));
});

const publicDns = async () => ['93.184.216.34'];
const ok = () => new Response('hello');

describe('safeFetch', () => {
  it('fetches a public https URL', async () => {
    const f = createSafeFetch({
      resolve: publicDns,
      fetch: vi.fn(async () => ok()) as never,
    });
    expect((await f.fetchText('https://example.com/x')).text).toBe('hello');
  });

  it.each([
    ['http scheme', 'http://example.com/'],
    ['file scheme', 'file:///etc/passwd'],
    ['credentials', 'https://user:pw@example.com/'],
    ['loopback literal', 'https://127.0.0.1/'],
    ['metadata literal', 'https://169.254.169.254/latest/meta-data'],
    ['ipv6 loopback', 'https://[::1]/'],
    ['garbage', 'not a url'],
  ])('refuses %s', async (_n, url) => {
    const fetchMock = vi.fn(async () => ok());
    const f = createSafeFetch({
      resolve: publicDns,
      fetch: fetchMock as never,
    });
    await expect(f(url)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to a private address (DNS pointing inward)', async () => {
    const f = createSafeFetch({
      resolve: async () => ['93.184.216.34', '10.0.0.5'],
      fetch: vi.fn() as never,
    });
    await expect(f('https://evil.example/')).rejects.toThrow('private');
  });

  it('refuses a host that does not resolve', async () => {
    const f = createSafeFetch({
      resolve: async () => [],
      fetch: vi.fn() as never,
    });
    await expect(f('https://nowhere.example/')).rejects.toThrow('resolve');
  });

  it('checks every redirect hop and drops credentials when leaving the host', async () => {
    const seen: Array<[string, string | null]> = [];
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      seen.push([String(url), new Headers(init.headers).get('authorization')]);
      return String(url).includes('a.example')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://b.example/next' },
          })
        : ok();
    });
    const f = createSafeFetch({
      resolve: publicDns,
      fetch: fetchMock as never,
    });
    await f('https://a.example/start', {
      headers: { authorization: 'Bearer t' },
    });
    expect(seen).toEqual([
      ['https://a.example/start', 'Bearer t'],
      ['https://b.example/next', null],
    ]);
  });

  it('refuses a redirect into the private network and redirect loops', async () => {
    const toPrivate = createSafeFetch({
      resolve: publicDns,
      fetch: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/' },
        })) as never,
    });
    await expect(toPrivate('https://a.example/')).rejects.toThrow('private');
    const loop = createSafeFetch({
      resolve: publicDns,
      fetch: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://a.example/' },
        })) as never,
    });
    await expect(loop('https://a.example/')).rejects.toThrow('redirects');
  });

  it('caps the body size, by header and by streaming', async () => {
    const big = createSafeFetch({
      resolve: publicDns,
      maxBytes: 10,
      fetch: (async () =>
        new Response('x', { headers: { 'content-length': '999' } })) as never,
    });
    await expect(big('https://a.example/')).rejects.toThrow('too large');
    const stream = createSafeFetch({
      resolve: publicDns,
      maxBytes: 10,
      fetch: (async () => new Response('x'.repeat(50))) as never,
    });
    await expect(stream.fetchText('https://a.example/')).rejects.toThrow(
      'too large',
    );
  });

  it('trusts configured hosts, including private ones and plain http', async () => {
    const f = createSafeFetch({
      allowHosts: ['gitlab.internal'],
      resolve: async () => ['10.0.0.9'],
      fetch: vi.fn(async () => ok()) as never,
    });
    expect((await f.fetchText('http://gitlab.internal/api')).text).toBe(
      'hello',
    );
    await expect(f('http://other.internal/')).rejects.toThrow();
  });

  it('allowPrivate opens everything for development', async () => {
    const f = createSafeFetch({
      allowPrivate: true,
      fetch: vi.fn(async () => ok()) as never,
    });
    expect((await f('http://127.0.0.1:9000/')).status).toBe(200);
  });
});
