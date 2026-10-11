import { createHash, createHmac } from 'node:crypto';

export interface SigV4Input {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body (`sha256Hex('')` for none). */
  payloadHash: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  now: Date;
}

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** AWS Signature Version 4. Returns the request headers to send, including `authorization`. */
export function signV4(i: SigV4Input): Record<string, string> {
  const amzDate = i.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: i.url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': i.payloadHash,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...i.url.searchParams]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  // S3 paths are encoded once (the URL already is); other services encode twice. We only sign S3.
  const canonical = [
    i.method,
    i.url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    i.payloadHash,
  ].join('\n');
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonical),
  ].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${i.secretKey}`, date), i.region), i.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
