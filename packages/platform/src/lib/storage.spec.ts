import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sha256Hex, signV4 } from './sigv4.ts';
import { assertKey, createFsStorage, createMemoryStorage, createS3Storage, type ObjectStorage } from './storage.ts';

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const bytes = (s: string) => new TextEncoder().encode(s);

describe('sigv4', () => {
  it('matches the AWS documented GET Object example', () => {
    const h = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: sha256Hex(''),
      region: 'us-east-1',
      service: 's3',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h['authorization']).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('keys', () => {
  it.each(['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'a/./b', 'nul\0'])('rejects %j', (k) => {
    expect(() => assertKey(k)).toThrow();
  });
  it('accepts ordinary keys', () => expect(() => assertKey('builds/1/site.tar')).not.toThrow());
});

function contract(name: string, make: () => Promise<ObjectStorage> | ObjectStorage) {
  describe(`${name} storage`, () => {
    it('puts, gets, lists, deletes', async () => {
      const s = await make();
      await s.ping();
      expect(await s.get('a/one.txt')).toBeUndefined();
      await s.put('a/one.txt', bytes('1'), 'text/plain');
      await s.put('a/two & three.txt', bytes('23'));
      await s.put('b/x.txt', bytes('x'));
      expect(text(await s.get('a/one.txt'))).toBe('1');
      expect(await s.list('a/')).toEqual(['a/one.txt', 'a/two & three.txt']);
      await s.delete('a/one.txt');
      await s.delete('a/one.txt');
      expect(await s.get('a/one.txt')).toBeUndefined();
    });
    it('refuses path traversal', async () => {
      const s = await make();
      await expect(s.put('../escape', bytes('x'))).rejects.toThrow();
      await expect(s.get('a/../../etc/passwd')).rejects.toThrow();
    });
  });
}

contract('memory', createMemoryStorage);
const dir = mkdtemp(join(tmpdir(), 'dkd-fs-'));
afterAll(async () => rm(await dir, { recursive: true, force: true }));
contract('fs', async () => createFsStorage(join(await dir, String(Math.random()))));

/** A tiny in-memory S3: checks that every request is signed, then behaves like the real thing. */
function fakeS3() {
  const store = new Map<string, Uint8Array>();
  const calls: { method: string; auth: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    calls.push({ method, auth: headers['authorization'] ?? '' });
    const key = decodeURIComponent(url.pathname.replace(/^\/bkt\/?/, ''));
    if (method === 'PUT') {
      store.set(key, new Uint8Array(init!.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
      store.delete(key);
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.get('list-type')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const token = url.searchParams.get('continuation-token');
      const start = token ? Number(token) : 0;
      const page = all.slice(start, start + 1);
      const more = start + 1 < all.length;
      const esc = (s: string) => s.replace(/&/g, '&amp;');
      return new Response(
        `<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : ''}${page.map((k) => `<Contents><Key>${esc(k)}</Key></Contents>`).join('')}</ListBucketResult>`,
      );
    }
    const v = store.get(key);
    return v ? new Response(v as BodyInit) : new Response('<Error/>', { status: 404 });
  };
  return { fetchImpl, calls };
}

const s3 = fakeS3();
contract('s3', () =>
  createS3Storage({ endpoint: 'http://minio:9000', region: 'us-east-1', bucket: 'bkt', accessKey: 'AK', secretKey: 'SK', fetch: s3.fetchImpl }),
);

describe('s3 errors', () => {
  it('reports status without leaking the secret key', async () => {
    const s = createS3Storage({
      endpoint: 'http://minio:9000', region: 'r', bucket: 'bkt', accessKey: 'AK', secretKey: 'SUPERSECRETKEY',
      fetch: async () => new Response('denied', { status: 403 }),
    });
    const err = await s.put('k', bytes('x')).catch((e: Error) => e);
    expect((err as Error).message).toContain('403');
    expect((err as Error).message).not.toContain('SUPERSECRETKEY');
    await expect(s.get('k')).rejects.toThrow('403');
    await expect(s.list('')).rejects.toThrow('403');
    await expect(s.ping()).rejects.toThrow('403');
    await expect(s.delete('k')).rejects.toThrow('403');
  });
  it('signs every request', () => {
    expect(s3.calls.length).toBeGreaterThan(0);
    expect(s3.calls.every((c) => c.auth.startsWith('AWS4-HMAC-SHA256 Credential=AK/'))).toBe(true);
  });
});
