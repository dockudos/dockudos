/**
 * The model of the API client: collections of saved requests, environments and history. It is plain JSON, kept in the
 * reader's own browser (see `client-db.ts` in `@dockudos/ui`), written to export files and read back from them.
 *
 * Two rules hold everywhere in here:
 * - A saved request never carries a credential. Values that came from the playground's Authorization tab, and anything
 *   that matches a secret variable, are taken out before a request is stored, exported or shared (`redactRequest`).
 * - Nothing in this file touches the network, the DOM or storage, so every rule below is unit-tested.
 */

import type { RequestValues } from './request.ts';

/** The version written into every record and every exported file. */
export const CLIENT_SCHEMA_VERSION = 1;

/** Limits, so a reader cannot fill their own disk by accident and an imported file cannot either. */
export const CLIENT_LIMITS = {
  collections: 100,
  requestsPerCollection: 500,
  environments: 50,
  variablesPerEnvironment: 200,
  history: 100,
  nameLength: 120,
  /** Of a stored body, in characters. */
  bodyLength: 200_000,
  headers: 100,
} as const;

/** A request as it is stored: HTTP, not form fields, so it can be replayed, exported and shared as it is. */
export interface StoredRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: { contentType: string; text: string };
}

/** Where a saved request came from, so an endpoint page can fill its form in again. */
export interface RequestOrigin {
  /** `ApiOperation.id`. */
  operationId: string;
  /** The page the endpoint lives on, to link back to it. */
  href?: string;
  /** The base URL that was chosen. */
  base: string;
  /** What was typed into the form, without credentials. */
  values: RequestValues;
}

export interface SavedRequest {
  id: string;
  collectionId: string;
  name: string;
  /** Position within its collection, lowest first. */
  order: number;
  createdAt: number;
  updatedAt: number;
  request: StoredRequest;
  origin?: RequestOrigin;
  /** Names of headers and parameters whose value was a credential and was left out. */
  redacted?: string[];
  /** The record's schema version. */
  v: number;
}

export interface Collection {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  v: number;
}

export interface EnvironmentVariable {
  name: string;
  value: string;
  /** Masked when shown, left out of exports and share links, and only remembered if the reader asks. */
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  order: number;
  variables: EnvironmentVariable[];
  v: number;
}

/** One sent request, for the History list. Bodies are not kept: only what it was and what came back. */
export interface HistoryEntry {
  id: string;
  at: number;
  method: string;
  url: string;
  status?: number;
  ms?: number;
  /** The send failed before there was an answer (CORS, no network, cancelled). */
  error?: string;
  /** The saved request it was sent from, if there was one. */
  requestId?: string;
}

/** Everything the client holds, as the UI gets it. */
export interface ClientData {
  collections: Collection[];
  requests: SavedRequest[];
  environments: Environment[];
  history: HistoryEntry[];
}

export const emptyClientData = (): ClientData => ({
  collections: [],
  requests: [],
  environments: [],
  history: [],
});

/**
 * An id that is unique in this browser. `crypto.randomUUID` where there is one (every browser that has IndexedDB), else
 * time and randomness, which is enough for records that never leave the machine.
 */
export function newId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto?.randomUUID;
  if (random) return random.call(globalThis.crypto);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const trimName = (name: string, fallback: string): string => {
  const text = name.trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, CLIENT_LIMITS.nameLength);
};

/** The name a saved request gets when the reader does not type one. */
export const suggestedName = (request: StoredRequest): string => {
  let path = request.url;
  try {
    path = new URL(request.url).pathname;
  } catch {
    // not a full URL yet: use what was typed
  }
  return trimName(`${request.method.toUpperCase()} ${path}`, 'Request');
};

// -- taking credentials out -------------------------------------------------

/** Header names that hold a credential whatever the spec says. */
const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

export interface RedactOptions {
  /** Credential values to take out wherever they appear: what the playground's Authorization tab holds. */
  secrets?: string[];
  /** The environment's variables: a value that matches a secret one becomes `{{name}}`, so a replay fills it in again. */
  variables?: EnvironmentVariable[];
  /** Header, query and cookie names of the operation's security schemes. */
  authFields?: string[];
}

export interface Redacted {
  request: StoredRequest;
  /** What was taken out, named, so the UI can say so. */
  redacted: string[];
}

const replaceAll = (
  text: string,
  secrets: { value: string; with: string }[],
): string =>
  secrets.reduce(
    (out, s) => (s.value ? out.split(s.value).join(s.with) : out),
    text,
  );

/**
 * A copy of the request with no credential in it. A value that matches a secret variable becomes `{{that name}}`; any
 * other credential (the `Authorization` header, an API key field, a value passed in `secrets`) is emptied and named in
 * `redacted`. This is what gets stored, exported and shared.
 *
 * An authentication field keeps its value only when the value refers to a variable: the credential then lives in the
 * environment, which the reader controls, and not in a record that an export or a link would carry.
 */
export function redactRequest(
  request: StoredRequest,
  { secrets = [], variables = [], authFields = [] }: RedactOptions = {},
): Redacted {
  const named = variables
    .filter((v) => v.secret && v.value)
    .map((v) => ({ value: v.value, with: `{{${v.name}}}` }));
  const blind = secrets
    .filter(Boolean)
    .filter((s) => !named.some((n) => n.value === s));
  const authNames = new Set(authFields.map((n) => n.toLowerCase()));
  const redacted: string[] = [];
  const note = (name: string) => {
    if (!redacted.includes(name)) redacted.push(name);
  };

  const clean = (text: string, where: string): string => {
    const withNames = replaceAll(text, named);
    return blind.reduce((out, s) => {
      if (!out.includes(s)) return out;
      note(where);
      return out.split(s).join('');
    }, withNames);
  };

  const headers: [string, string][] = [];
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (SECRET_HEADERS.has(lower) || authNames.has(lower)) {
      const kept = replaceAll(value, named);
      if (value && !kept.includes('{{')) {
        note(name);
        headers.push([name, '']);
      } else {
        headers.push([name, kept]);
      }
      continue;
    }
    headers.push([name, clean(value, name)]);
  }

  const url = redactUrl(request.url, named, authNames, note);
  return {
    request: {
      method: request.method,
      url: clean(url, 'url'),
      headers,
      body: request.body && {
        contentType: request.body.contentType,
        text: clean(request.body.text, 'body').slice(
          0,
          CLIENT_LIMITS.bodyLength,
        ),
      },
    },
    redacted,
  };
}

/** Query parameters that carry an API key are emptied; the rest of the URL is left alone. */
function redactUrl(
  url: string,
  named: { value: string; with: string }[],
  authNames: Set<string>,
  note: (name: string) => void,
): string {
  const at = url.indexOf('?');
  if (at < 0 || !authNames.size) return url;
  const before = url.slice(0, at);
  const parts = url
    .slice(at + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
      if (eq < 0 || !authNames.has(key.toLowerCase())) return pair;
      const value = decodeURIComponent(pair.slice(eq + 1));
      const kept = replaceAll(value, named);
      if (kept.includes('{{')) {
        return `${pair.slice(0, eq)}=${encodeURIComponent(kept)}`;
      }
      if (value) note(key);
      return `${pair.slice(0, eq)}=`;
    });
  return `${before}?${parts.join('&')}`;
}

/** The names an operation's security schemes use in a request, for `redactRequest`. */
export function authFieldNames(
  schemes: Record<string, { type: string; in?: string; name?: string }>,
): string[] {
  const names = new Set<string>(['authorization']);
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === 'apiKey' && scheme.name) names.add(scheme.name);
  }
  return [...names];
}

/** `sk-live-abcdef` as `sk-l••••••ef`: enough to tell two secrets apart, not enough to use one. */
export const maskSecret = (value: string): string => {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(6)}${value.slice(-2)}`;
};

// -- reading records back ---------------------------------------------------

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const pairs = (v: unknown): [string, string][] =>
  Array.isArray(v)
    ? v
        .filter(
          (p): p is [string, string] =>
            Array.isArray(p) && typeof p[0] === 'string',
        )
        .map(([k, value]) => [k, str(value)] as [string, string])
        .slice(0, CLIENT_LIMITS.headers)
    : [];

/** A stored or imported request, with what is missing filled in and what is unexpected dropped. */
export function readRequest(raw: unknown): StoredRequest | undefined {
  if (!isObject(raw)) return undefined;
  const url = str(raw.url);
  if (!url) return undefined;
  const body = isObject(raw.body)
    ? {
        contentType: str(raw.body.contentType, 'application/json'),
        text: str(raw.body.text).slice(0, CLIENT_LIMITS.bodyLength),
      }
    : undefined;
  return {
    method: (str(raw.method, 'GET') || 'GET').toUpperCase(),
    url,
    headers: pairs(raw.headers),
    body: body?.text ? body : undefined,
  };
}

/**
 * A record as this version understands it: fields an older version did not write are filled in, fields it does not know
 * are dropped. A record from a *newer* schema is left alone (`undefined` here) instead of being rewritten wrongly by
 * old code, which is what keeps two tabs on different versions from spoiling each other's data.
 */
export function migrateSavedRequest(raw: unknown): SavedRequest | undefined {
  if (!isObject(raw)) return undefined;
  if (num(raw.v, 0) > CLIENT_SCHEMA_VERSION) return undefined;
  const request = readRequest(raw.request);
  if (!request) return undefined;
  const createdAt = num(raw.createdAt, Date.now());
  const origin = isObject(raw.origin) ? raw.origin : undefined;
  return {
    id: str(raw.id) || newId(),
    collectionId: str(raw.collectionId),
    name: trimName(str(raw.name), suggestedName(request)),
    order: num(raw.order, createdAt),
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
    request,
    ...(origin && typeof origin.operationId === 'string'
      ? {
          origin: {
            operationId: origin.operationId,
            ...(typeof origin.href === 'string' ? { href: origin.href } : {}),
            base: str(origin.base),
            values: isObject(origin.values)
              ? (origin.values as unknown as RequestValues)
              : { path: {}, query: {}, header: {}, cookie: {} },
          },
        }
      : {}),
    ...(Array.isArray(raw.redacted)
      ? {
          redacted: raw.redacted.filter(
            (n): n is string => typeof n === 'string',
          ),
        }
      : {}),
    v: CLIENT_SCHEMA_VERSION,
  };
}

export function migrateCollection(raw: unknown): Collection | undefined {
  if (!isObject(raw)) return undefined;
  if (num(raw.v, 0) > CLIENT_SCHEMA_VERSION) return undefined;
  const createdAt = num(raw.createdAt, Date.now());
  return {
    id: str(raw.id) || newId(),
    name: trimName(str(raw.name), 'Collection'),
    order: num(raw.order, createdAt),
    createdAt,
    v: CLIENT_SCHEMA_VERSION,
  };
}

export function migrateEnvironment(raw: unknown): Environment | undefined {
  if (!isObject(raw)) return undefined;
  if (num(raw.v, 0) > CLIENT_SCHEMA_VERSION) return undefined;
  return {
    id: str(raw.id) || newId(),
    name: trimName(str(raw.name), 'Environment'),
    order: num(raw.order, 0),
    variables: readVariables(raw.variables),
    v: CLIENT_SCHEMA_VERSION,
  };
}

/** The variables of an environment: non-empty names, each one once, within the limit. */
export function readVariables(raw: unknown): EnvironmentVariable[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EnvironmentVariable[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const name = str(entry.name).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      value: str(entry.value),
      ...(entry.secret === true ? { secret: true as const } : {}),
    });
    if (out.length >= CLIENT_LIMITS.variablesPerEnvironment) break;
  }
  return out;
}

export function migrateHistoryEntry(raw: unknown): HistoryEntry | undefined {
  if (!isObject(raw)) return undefined;
  const url = str(raw.url);
  if (!url) return undefined;
  return {
    id: str(raw.id) || newId(),
    at: num(raw.at, Date.now()),
    method: (str(raw.method, 'GET') || 'GET').toUpperCase(),
    url,
    ...(typeof raw.status === 'number' ? { status: raw.status } : {}),
    ...(typeof raw.ms === 'number' ? { ms: raw.ms } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    ...(typeof raw.requestId === 'string' ? { requestId: raw.requestId } : {}),
  };
}

/** The `order` that puts a new item last. */
export const lastOrder = (items: { order: number }[]): number =>
  items.reduce((max, i) => Math.max(max, i.order), 0) + 1;

/** `items` with `id` moved to position `to`, renumbered from 1. */
export function reorder<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  to: number,
): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((i) => i.id === id);
  if (from < 0) return sorted;
  const target = Math.max(0, Math.min(sorted.length - 1, to));
  const [moved] = sorted.splice(from, 1);
  sorted.splice(target, 0, moved as T);
  return sorted.map((item, i) => ({ ...item, order: i + 1 }));
}
