import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Clock, systemClock } from './clock.ts';
import { sha256Hex, signV4 } from './sigv4.ts';

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  /** Keys under a prefix, sorted. */
  list(prefix: string): Promise<string[]>;
  ping(): Promise<void>;
}

/** Keys are `/`-separated paths with no `.` or `..` parts, no leading slash, no NUL or backslash. */
export function assertKey(key: string): void {
  if (
    !key ||
    key.length > 900 ||
    key.startsWith('/') ||
    /[\0\\]/.test(key) ||
    key.split('/').some((p) => p === '' || p === '.' || p === '..')
  )
    throw new Error(`Invalid storage key: ${JSON.stringify(key.slice(0, 80))}`);
}

export function createMemoryStorage(): ObjectStorage & {
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      assertKey(key);
      objects.set(key, new Uint8Array(body));
    },
    async get(key) {
      assertKey(key);
      return objects.get(key);
    },
    async delete(key) {
      assertKey(key);
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async ping() {
      // Nothing to reach.
    },
  };
}

/** Objects as files under `root`. For single-host installs and development; use S3 for anything shared. */
export function createFsStorage(root: string): ObjectStorage {
  const base = resolve(root);
  const path = (key: string) => {
    assertKey(key);
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error('Invalid storage key.');
    return full;
  };
  async function walk(dir: string, out: string[]) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, out);
      else
        out.push(
          p
            .slice(base.length + 1)
            .split(sep)
            .join('/'),
        );
    }
  }
  return {
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(path(key)));
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code === 'ENOENT' ||
          (e as NodeJS.ErrnoException).code === 'EISDIR'
        )
          return undefined;
        throw e;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
    async list(prefix) {
      const out: string[] = [];
      await walk(base, out);
      return out.filter((k) => k.startsWith(prefix)).sort();
    },
    async ping() {
      await mkdir(base, { recursive: true });
      await stat(base);
    },
  };
}

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  fetch?: typeof fetch;
  clock?: Clock;
}

/** An S3-compatible client (AWS S3, MinIO, R2, Ceph): path-style URLs and Signature V4, with no SDK. */
export function createS3Storage({
  endpoint,
  region,
  bucket,
  accessKey,
  secretKey,
  fetch: doFetch = fetch,
  clock = systemClock,
}: S3Options): ObjectStorage {
  const base = endpoint.replace(/\/+$/, '');
  const keyUrl = (key: string, query = '') => {
    assertKey(key);
    return new URL(
      `${base}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}${query}`,
    );
  };
  async function send(
    method: string,
    url: URL,
    body?: Uint8Array,
    contentType?: string,
  ) {
    const payload = body ?? new Uint8Array();
    const headers = signV4({
      method,
      url,
      headers: contentType ? { 'content-type': contentType } : {},
      payloadHash: sha256Hex(payload),
      region,
      service: 's3',
      accessKey,
      secretKey,
      now: clock(),
    });
    const sendHeaders = { ...headers };
    delete sendHeaders['host'];
    return doFetch(url, {
      method,
      headers: sendHeaders,
      ...(body && { body: body as NonNullable<RequestInit['body']> }),
    });
  }
  const fail = async (what: string, r: Response) => {
    throw new Error(
      `S3 ${what} failed: ${r.status} ${(await r.text()).slice(0, 200)}`,
    );
  };
  return {
    async put(key, body, contentType = 'application/octet-stream') {
      const r = await send('PUT', keyUrl(key), body, contentType);
      if (!r.ok) await fail('put', r);
    },
    async get(key) {
      const r = await send('GET', keyUrl(key));
      if (r.status === 404) return undefined;
      if (!r.ok) await fail('get', r);
      return new Uint8Array(await r.arrayBuffer());
    },
    async delete(key) {
      const r = await send('DELETE', keyUrl(key));
      if (!r.ok && r.status !== 404) await fail('delete', r);
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const url = new URL(`${base}/${bucket}`);
        url.searchParams.set('list-type', '2');
        url.searchParams.set('prefix', prefix);
        if (token) url.searchParams.set('continuation-token', token);
        const r = await send('GET', url);
        if (!r.ok) await fail('list', r);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g))
          keys.push(unxml(m[1]!));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? unxml(
              /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(
                xml,
              )?.[1] ?? '',
            ) || undefined
          : undefined;
      } while (token);
      return keys.sort();
    },
    async ping() {
      const url = new URL(`${base}/${bucket}`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', '1');
      const r = await send('GET', url);
      if (!r.ok) await fail('ping', r);
    },
  };
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
