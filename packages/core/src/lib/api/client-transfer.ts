/**
 * Moving saved requests in and out of the API client: Postman collections (v2.1), Bruno collections and `.bru` files,
 * a cURL command, this project's own JSON file, and a request as a link.
 *
 * Importing **reads text and nothing else**. Scripts, tests and pre-request hooks that a Postman or Bruno file may
 * carry are dropped and named in `warnings`; nothing from a file is ever run. Credentials are not imported either: an
 * authentication field keeps its value only when the value is a `{{variable}}` reference (see `redactRequest`).
 */

import {
  CLIENT_LIMITS,
  CLIENT_SCHEMA_VERSION,
  type Collection,
  type Environment,
  type EnvironmentVariable,
  type SavedRequest,
  type StoredRequest,
  migrateEnvironment,
  isObject,
  newId,
  readRequest,
  readVariables,
  redactRequest,
  str,
  suggestedName,
  trimName,
} from './client.ts';
import { usedVariables } from './client-variables.ts';
import { utf8ToBase64 } from './request.ts';
import { shellQuote } from './samples.ts';

/** What an import produced: collections, their requests, any environments, and what was skipped. */
export interface Imported {
  collections: Collection[];
  requests: SavedRequest[];
  environments: Environment[];
  warnings: string[];
}

const empty = (): Imported => ({
  collections: [],
  requests: [],
  environments: [],
  warnings: [],
});

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A request as it is stored, with credentials taken out and the body cut to the limit. */
const safe = (
  request: StoredRequest,
): { request: StoredRequest; redacted: string[] } =>
  redactRequest(request, { authFields: ['authorization'] });

function makeCollection(name: string, order: number): Collection {
  return {
    id: newId(),
    name: trimName(name, 'Imported'),
    order,
    createdAt: Date.now(),
    v: CLIENT_SCHEMA_VERSION,
  };
}

function makeRequest(
  collectionId: string,
  name: string,
  request: StoredRequest,
  order: number,
): SavedRequest {
  const cleaned = safe(request);
  const now = Date.now();
  return {
    id: newId(),
    collectionId,
    name:
      trimName(name, suggestedName(request)),
    order,
    createdAt: now,
    updatedAt: now,
    request: cleaned.request,
    ...(cleaned.redacted.length ? { redacted: cleaned.redacted } : {}),
    v: CLIENT_SCHEMA_VERSION,
  };
}

/** Cut an import to the limits and say so, so one file cannot fill a reader's storage. */
function capped(result: Imported): Imported {
  const warnings = [...result.warnings];
  let collections = result.collections;
  if (collections.length > CLIENT_LIMITS.collections) {
    warnings.push(
      `Only the first ${CLIENT_LIMITS.collections} collections of the file were imported.`,
    );
    collections = collections.slice(0, CLIENT_LIMITS.collections);
  }
  const ids = new Set(collections.map((c) => c.id));
  let requests = result.requests.filter((r) => ids.has(r.collectionId));
  const perCollection = new Map<string, number>();
  requests = requests.filter((r) => {
    const n = (perCollection.get(r.collectionId) ?? 0) + 1;
    perCollection.set(r.collectionId, n);
    return n <= CLIENT_LIMITS.requestsPerCollection;
  });
  if (requests.length < result.requests.length) {
    warnings.push(
      `A collection may hold ${CLIENT_LIMITS.requestsPerCollection} requests; the rest were left out.`,
    );
  }
  return {
    collections,
    requests,
    environments: result.environments.slice(0, CLIENT_LIMITS.environments),
    warnings,
  };
}

// -- this project's own file -----------------------------------------------

/** The file `dockudos` writes: the collections as they are, with no secret value in them. */
export interface DockudosClientFile {
  dockudos: 'api-client';
  version: number;
  exportedAt: string;
  collections: {
    name: string;
    requests: { name: string; request: StoredRequest }[];
  }[];
  environments: {
    name: string;
    variables: { name: string; value: string; secret?: boolean }[];
  }[];
}

export interface ExportInput {
  collections: readonly Collection[];
  requests: readonly SavedRequest[];
  environments?: readonly Environment[];
}

/**
 * The export file. Values of secret variables are left out (the name and `secret: true` stay, so the person importing
 * knows what to fill in); a request's authentication field is already a variable reference or empty.
 */
export function toDockudosFile({
  collections,
  requests,
  environments = [],
}: ExportInput): DockudosClientFile {
  const order = (a: { order: number }, b: { order: number }) =>
    a.order - b.order;
  return {
    dockudos: 'api-client',
    version: CLIENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    collections: [...collections].sort(order).map((collection) => ({
      name: collection.name,
      requests: requests
        .filter((r) => r.collectionId === collection.id)
        .sort(order)
        .map((r) => ({ name: r.name, request: safe(r.request).request })),
    })),
    environments: [...environments].sort(order).map((environment) => ({
      name: environment.name,
      variables: environment.variables.map((v) => ({
        name: v.name,
        value: v.secret ? '' : v.value,
        ...(v.secret ? { secret: true as const } : {}),
      })),
    })),
  };
}

function fromDockudosFile(file: Record<string, unknown>): Imported {
  const result = empty();
  if (
    typeof file.version === 'number' &&
    file.version > CLIENT_SCHEMA_VERSION
  ) {
    result.warnings.push(
      `The file was written by a newer version (${file.version}); anything this version does not know was left out.`,
    );
  }
  list(file.collections).forEach((raw, i) => {
    if (!isObject(raw)) return;
    const collection = makeCollection(str(raw.name) || 'Imported', i + 1);
    result.collections.push(collection);
    list(raw.requests).forEach((entry, j) => {
      if (!isObject(entry)) return;
      const request = readRequest(entry.request);
      if (!request) return;
      result.requests.push(
        makeRequest(collection.id, str(entry.name), request, j + 1),
      );
    });
  });
  list(file.environments).forEach((raw, i) => {
    if (!isObject(raw)) return;
    const environment = migrateEnvironment({ ...raw, order: i + 1 });
    if (environment) result.environments.push(environment);
  });
  return result;
}

// -- Postman v2.1 -----------------------------------------------------------

const POSTMAN_SCHEMA =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const bodyLanguage = (contentType: string): string =>
  /json/i.test(contentType)
    ? 'json'
    : /xml/i.test(contentType)
      ? 'xml'
      : /html/i.test(contentType)
        ? 'html'
        : 'text';

/** A Postman collection (v2.1) holding one collection's requests. */
export function toPostman(
  collection: Collection,
  requests: readonly SavedRequest[],
): Record<string, unknown> {
  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      schema: POSTMAN_SCHEMA,
    },
    item: [...requests]
      .sort((a, b) => a.order - b.order)
      .map((saved) => {
        const { request } = safe(saved.request);
        return {
          name: saved.name,
          request: {
            method: request.method,
            header: request.headers.map(([key, value]) => ({ key, value })),
            ...(request.body
              ? {
                  body: {
                    mode: 'raw',
                    raw: request.body.text,
                    options: {
                      raw: { language: bodyLanguage(request.body.contentType) },
                    },
                  },
                }
              : {}),
            url: { raw: request.url },
          },
        };
      }),
  };
}

/** Postman's URL object, which may be a string or split into parts. */
function postmanUrl(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!isObject(raw)) return '';
  if (typeof raw.raw === 'string') return raw.raw;
  const host = Array.isArray(raw.host)
    ? raw.host.join('.')
    : str(raw.host);
  const path = Array.isArray(raw.path)
    ? raw.path.map((p) => str(p)).join('/')
    : str(raw.path);
  const protocol = str(raw.protocol) || 'https';
  const query = list(raw.query)
    .filter(isObject)
    .filter((q) => q.disabled !== true)
    .map((q) => `${str(q.key)}=${str(q.value)}`)
    .join('&');
  const base = host ? `${protocol}://${host}${path ? `/${path}` : ''}` : path;
  return query ? `${base}?${query}` : base;
}

function postmanBody(
  raw: unknown,
  warn: (text: string) => void,
): StoredRequest['body'] {
  if (!isObject(raw)) return undefined;
  const mode = str(raw.mode);
  if (mode === 'raw') {
    const text = str(raw.raw);
    const language =
      isObject(raw.options) && isObject(raw.options.raw)
        ? str(raw.options.raw.language)
        : '';
    const contentType =
      language === 'json' || /^\s*[[{]/.test(text)
        ? 'application/json'
        : language === 'xml'
          ? 'application/xml'
          : 'text/plain';
    return text ? { contentType, text } : undefined;
  }
  if (mode === 'urlencoded') {
    const text = list(raw.urlencoded)
      .filter(isObject)
      .filter((p) => p.disabled !== true)
      .map(
        (p) =>
          `${encodeURIComponent(str(p.key))}=${encodeURIComponent(str(p.value))}`,
      )
      .join('&');
    return text
      ? { contentType: 'application/x-www-form-urlencoded', text }
      : undefined;
  }
  if (mode) warn(`a ${mode} body cannot be imported and was left out`);
  return undefined;
}

function fromPostman(file: Record<string, unknown>): Imported {
  const result = empty();
  const name = isObject(file.info) ? str(file.info.name) : '';
  const collection = makeCollection(name || 'Postman collection', 1);
  result.collections.push(collection);
  let order = 0;
  const scripted = new Set<string>();

  const walk = (items: unknown[], path: string[]) => {
    for (const item of items) {
      if (!isObject(item)) continue;
      const itemName = str(item.name);
      if (list(item.event).length) scripted.add(itemName || 'a request');
      if (Array.isArray(item.item)) {
        walk(item.item, [...path, itemName]);
        continue;
      }
      const raw = item.request;
      const requestObject = isObject(raw) ? raw : undefined;
      const url = requestObject ? postmanUrl(requestObject.url) : str(raw);
      if (!url) continue;
      // The name as the list shows it, so a warning names something the reader can find.
      const label = [...path, itemName].filter(Boolean).join(' / ') || url;
      const request: StoredRequest = {
        method: (str(requestObject?.method) || 'GET').toUpperCase(),
        url,
        headers: list(requestObject?.header)
          .filter(isObject)
          .filter((header) => header.disabled !== true)
          .map(postmanHeader)
          .filter((header): header is [string, string] => !!header),
        body: postmanBody(requestObject?.body, (text) =>
          result.warnings.push(`${label}: ${text}`),
        ),
      };
      if (isObject(requestObject?.auth)) {
        result.warnings.push(
          `${label}: the authentication saved in the file was not imported; add it as a secret variable.`,
        );
      }
      order += 1;
      result.requests.push(makeRequest(collection.id, label, request, order));
    }
  };
  walk(list(file.item), []);

  if (scripted.size) {
    result.warnings.push(
      `Scripts in the file were ignored and never run (${[...scripted].slice(0, 3).join(', ')}${scripted.size > 3 ? ', …' : ''}).`,
    );
  }
  const variables = readVariables(
    list(file.variable)
      .filter(isObject)
      .map((v) => ({ name: str(v.key), value: str(v.value) })),
  );
  if (variables.length) {
    result.environments.push({
      id: newId(),
      name: `${collection.name} variables`,
      order: 1,
      variables,
      v: CLIENT_SCHEMA_VERSION,
    });
  }
  return result;
}

/** One Postman header entry as a pair. */
const postmanHeader = (
  header: Record<string, unknown>,
): [string, string] | undefined => {
  const key = str(header.key);
  return key ? [key, str(header.value)] : undefined;
};

// -- Bruno ------------------------------------------------------------------

const BRUNO_MODES: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  sparql: 'application/sparql-query',
  graphql: 'application/json',
  formUrlEncoded: 'application/x-www-form-urlencoded',
};

/** A Bruno collection, the shape Bruno's "export collection" writes. */
export function toBruno(
  collection: Collection,
  requests: readonly SavedRequest[],
): Record<string, unknown> {
  return {
    name: collection.name,
    version: '1',
    items: [...requests]
      .sort((a, b) => a.order - b.order)
      .map((saved, i) => {
        const { request } = safe(saved.request);
        const mode =
          Object.entries(BRUNO_MODES).find(
            ([, type]) => request.body && type === request.body.contentType,
          )?.[0] ?? 'text';
        return {
          type: 'http',
          name: saved.name,
          seq: i + 1,
          request: {
            url: request.url,
            method: request.method,
            headers: request.headers.map(([name, value], index) => ({
              name,
              value,
              enabled: true,
              uid: `${saved.id}-${index}`,
            })),
            params: [],
            body: request.body
              ? { mode, [mode]: request.body.text }
              : { mode: 'none' },
            auth: { mode: 'none' },
          },
        };
      }),
    environments: [],
  };
}

function brunoRequest(
  raw: unknown,
  warn: (text: string) => void,
): StoredRequest | undefined {
  if (!isObject(raw)) return undefined;
  const url = str(raw.url);
  if (!url) return undefined;
  const body = isObject(raw.body) ? raw.body : undefined;
  const mode = str(body?.mode);
  const text = mode && body ? str(body[mode]) : '';
  if (mode === 'multipartForm' || mode === 'file') {
    warn(`a ${mode} body cannot be imported and was left out`);
  }
  return {
    method: (str(raw.method) || 'GET').toUpperCase(),
    url,
    headers: list(raw.headers)
      .filter(isObject)
      .filter((h) => h.enabled !== false)
      .map((h) => [str(h.name), str(h.value)] as [string, string])
      .filter(([name]) => !!name),
    body: text
      ? { contentType: BRUNO_MODES[mode] ?? 'text/plain', text }
      : undefined,
  };
}

function fromBrunoJson(file: Record<string, unknown>): Imported {
  const result = empty();
  const collection = makeCollection(
    str(file.name) || 'Bruno collection',
    1,
  );
  result.collections.push(collection);
  let order = 0;
  let scripts = false;
  const walk = (items: unknown[], path: string[]) => {
    for (const item of items) {
      if (!isObject(item)) continue;
      const name = str(item.name);
      if (Array.isArray(item.items)) {
        walk(item.items, [...path, name]);
        continue;
      }
      if (
        isObject(item.request) &&
        (item.request.script || item.request.tests)
      ) {
        scripts = true;
      }
      const request = brunoRequest(item.request, (text) =>
        result.warnings.push(`${name || 'a request'}: ${text}`),
      );
      if (!request) continue;
      order += 1;
      result.requests.push(
        makeRequest(
          collection.id,
          [...path, name].filter(Boolean).join(' / '),
          request,
          order,
        ),
      );
    }
  };
  walk(list(file.items), []);
  if (scripts) {
    result.warnings.push(
      'Scripts and tests in the file were ignored and never run.',
    );
  }
  list(file.environments).forEach((raw, i) => {
    if (!isObject(raw)) return;
    const variables = readVariables(
      list(raw.variables)
        .filter(isObject)
        .filter((v) => v.enabled !== false)
        .map((v) => ({
          name: str(v.name),
          value: str(v.value),
          ...(v.secret === true ? { secret: true } : {}),
        })),
    );
    result.environments.push({
      id: newId(),
      name: str(raw.name) || `Environment ${i + 1}`,
      order: i + 1,
      variables,
      v: CLIENT_SCHEMA_VERSION,
    });
  });
  return result;
}

/**
 * A single `.bru` file, the format a Bruno collection keeps in Git. Only the blocks that describe a request are read:
 * `script`, `tests` and `vars:pre-request` are listed in `warnings` and dropped.
 */
export function fromBruFile(text: string): Imported {
  const result = empty();
  const blocks = readBruBlocks(text);
  const meta = blocks.find((b) => b.name === 'meta');
  const name = meta ? (readBruPairs(meta.body).name ?? '') : '';
  const verb = blocks.find((b) =>
    /^(get|post|put|patch|delete|head|options|trace)$/.test(b.name),
  );
  if (!verb) {
    return { ...result, warnings: ['No request found in the .bru file.'] };
  }
  const fields = readBruPairs(verb.body);
  const url = fields.url ?? '';
  if (!url) return { ...result, warnings: ['The .bru file has no URL.'] };
  const headerBlock = blocks.find((b) => b.name === 'headers');
  const headers = headerBlock
    ? Object.entries(readBruPairs(headerBlock.body)).map(
        ([key, value]) => [key, value] as [string, string],
      )
    : [];
  const bodyBlock = blocks.find((b) => b.name.startsWith('body'));
  const mode = bodyBlock?.name.split(':')[1] ?? '';
  const body = bodyBlock?.body.trim()
    ? {
        contentType: BRUNO_MODES[mode] ?? 'text/plain',
        text: bodyBlock.body.trim(),
      }
    : undefined;
  if (
    blocks.some(
      (b) =>
        b.name === 'script' ||
        b.name === 'tests' ||
        b.name.startsWith('script:'),
    )
  ) {
    result.warnings.push(
      'Scripts and tests in the .bru file were ignored and never run.',
    );
  }
  const collection = makeCollection(name || 'Bruno request', 1);
  result.collections.push(collection);
  result.requests.push(
    makeRequest(
      collection.id,
      name,
      { method: verb.name.toUpperCase(), url, headers, body },
      1,
    ),
  );
  return result;
}

/** `name { ... }` blocks of a `.bru` file, nesting of braces inside a block kept. */
function readBruBlocks(text: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const head = /(^|\n)\s*([A-Za-z][\w:-]*)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = head.exec(text))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    blocks.push({ name: match[2] as string, body: text.slice(start, i - 1) });
    head.lastIndex = i;
  }
  return blocks;
}

/** `key: value` lines of a `.bru` block. A line starting with `~` is a disabled entry and is skipped. */
function readBruPairs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('~') || text.startsWith('#')) continue;
    const at = text.indexOf(':');
    if (at <= 0) continue;
    out[text.slice(0, at).trim()] = text.slice(at + 1).trim();
  }
  return out;
}

// -- cURL -------------------------------------------------------------------

/** The words of a shell command, quotes understood, line continuations removed. Nothing is run. */
export function splitCommand(command: string): string[] {
  const text = command.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1;
        current += text[i];
      } else current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started || current) words.push(current);
      current = '';
      started = false;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      i += 1;
      current += text[i];
      continue;
    }
    current += c;
  }
  if (started || current) words.push(current);
  return words;
}

export interface ParsedCurl {
  request?: StoredRequest;
  warnings: string[];
}

/**
 * A cURL command as a request. `-X`, `-H`, `-d` and friends, `--url`, `-u` and `-F` are understood; a flag that would
 * read a file (`-d @file`, `-F`) or run something is reported instead of followed.
 */
export function parseCurl(command: string): ParsedCurl {
  const words = splitCommand(command.trim());
  const warnings: string[] = [];
  if (!words.length || !/curl$|curl\.exe$/i.test(words[0] as string)) {
    return { warnings: ['Paste a command that starts with `curl`.'] };
  }
  let method = '';
  let url = '';
  const headers: [string, string][] = [];
  const data: string[] = [];
  let urlEncoded = false;
  let json = false;

  const next = (i: number): string => {
    const value = words[i + 1];
    if (value === undefined) {
      warnings.push(`${words[i]} needs a value; it was ignored.`);
      return '';
    }
    return value;
  };

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] as string;
    if (word === '-X' || word === '--request') {
      method = next(i).toUpperCase();
      i += 1;
    } else if (word === '-H' || word === '--header') {
      const text = next(i);
      i += 1;
      const at = text.indexOf(':');
      if (at > 0)
        headers.push([text.slice(0, at).trim(), text.slice(at + 1).trim()]);
    } else if (
      /^(-d|--data|--data-raw|--data-ascii|--data-binary)$/.test(word)
    ) {
      const value = next(i);
      i += 1;
      if (value.startsWith('@')) {
        warnings.push(
          `${word} ${value} reads a file, which an import does not do; the body was left out.`,
        );
      } else data.push(value);
    } else if (word === '--data-urlencode') {
      data.push(next(i));
      i += 1;
      urlEncoded = true;
    } else if (word === '--json') {
      data.push(next(i));
      i += 1;
      json = true;
    } else if (word === '--url') {
      url = next(i);
      i += 1;
    } else if (word === '-u' || word === '--user') {
      const credentials = next(i);
      i += 1;
      headers.push(['Authorization', `Basic ${utf8ToBase64(credentials)}`]);
    } else if (word === '-F' || word === '--form') {
      i += 1;
      warnings.push(
        'A form upload (-F) cannot be imported; the body was left out.',
      );
    } else if (word === '-b' || word === '--cookie') {
      headers.push(['Cookie', next(i)]);
      i += 1;
    } else if (word === '-A' || word === '--user-agent') {
      headers.push(['User-Agent', next(i)]);
      i += 1;
    } else if (
      /^(-o|--output|-w|--write-out|--max-time|--connect-timeout|-m|--retry|--proxy|-x|--cert|--key|--cacert|-e|--referer|--resolve|--interface)$/.test(
        word,
      )
    ) {
      warnings.push(`${word} is about how curl runs and was ignored.`);
      i += 1;
    } else if (word.startsWith('-')) {
      // Flags with no value of their own: --compressed, -L, -k, -s, -i, -v …
      if (!/^(-[a-zA-Z]+|--[a-z-]+)$/.test(word)) {
        warnings.push(`${word} was ignored.`);
      }
    } else if (!url) {
      url = word;
    }
  }

  if (!url) return { warnings: [...warnings, 'The command has no URL.'] };
  const hasBody = data.length > 0;
  const contentTypeHeader = headers.find(
    ([k]) => k.toLowerCase() === 'content-type',
  )?.[1];
  const text = urlEncoded || !hasBody ? data.join('&') : data.join('');
  const contentType =
    contentTypeHeader ??
    (json
      ? 'application/json'
      : urlEncoded
        ? 'application/x-www-form-urlencoded'
        : /^\s*[[{]/.test(text)
          ? 'application/json'
          : 'application/x-www-form-urlencoded');
  if (json && !contentTypeHeader)
    headers.push(['Content-Type', 'application/json']);
  return {
    request: {
      method: method || (hasBody ? 'POST' : 'GET'),
      url,
      headers,
      body: hasBody ? { contentType, text } : undefined,
    },
    warnings,
  };
}

/** A cURL command for a request, the same text the endpoint pages show. */
export function toCurl(request: StoredRequest): string {
  const lines = [
    `curl --request ${request.method}`,
    `  --url ${shellQuote(request.url)}`,
  ];
  for (const [name, value] of request.headers) {
    lines.push(`  --header ${shellQuote(`${name}: ${value}`)}`);
  }
  if (request.body?.text) lines.push(`  --data ${shellQuote(request.body.text)}`);
  return lines.join(' \\\n');
}

// -- what the file is -------------------------------------------------------

export type TransferFormat = 'dockudos' | 'postman' | 'bruno' | 'bru' | 'curl';

/** What a pasted or dropped text is, by what is in it rather than by its file name. */
export function detectFormat(text: string): TransferFormat | undefined {
  const trimmed = text.trim();
  if (/^curl(\.exe)?\s/i.test(trimmed)) return 'curl';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isObject(parsed)) return undefined;
      if (parsed.dockudos === 'api-client') return 'dockudos';
      if (isObject(parsed.info) && 'schema' in parsed.info) return 'postman';
      if (Array.isArray(parsed.item)) return 'postman';
      if (Array.isArray(parsed.items)) return 'bruno';
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (
    /(^|\n)\s*meta\s*\{/.test(text) ||
    /(^|\n)\s*(get|post|put|patch|delete)\s*\{/.test(text)
  ) {
    return 'bru';
  }
  return undefined;
}

/**
 * Read a file or pasted text in any of the supported formats. Unreadable text is reported, never thrown: the UI shows
 * the warning next to the import field.
 */
export function importText(text: string, format?: TransferFormat): Imported {
  const kind = format ?? detectFormat(text);
  if (!kind) {
    return {
      ...empty(),
      warnings: [
        'The file was not recognised. Supported: a dockudos export, a Postman v2.1 collection, a Bruno collection or .bru file, or a curl command.',
      ],
    };
  }
  if (kind === 'curl') {
    const { request, warnings } = parseCurl(text);
    if (!request) return { ...empty(), warnings };
    const collection = makeCollection('Imported', 1);
    return capped({
      collections: [collection],
      requests: [
        makeRequest(collection.id, suggestedName(request), request, 1),
      ],
      environments: [],
      warnings,
    });
  }
  if (kind === 'bru') return capped(fromBruFile(text));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ...empty(),
      warnings: [`The file is not valid JSON: ${(e as Error).message}`],
    };
  }
  if (!isObject(parsed)) {
    return { ...empty(), warnings: ['The file does not hold a collection.'] };
  }
  if (kind === 'dockudos') return capped(fromDockudosFile(parsed));
  if (kind === 'postman') return capped(fromPostman(parsed));
  return capped(fromBrunoJson(parsed));
}

// -- a request as a link ----------------------------------------------------

/** Longer than this and browsers and chat apps start cutting the link. */
const MAX_LINK = 8_000;

const toBase64Url = (text: string): string =>
  utf8ToBase64(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const fromBase64Url = (text: string): string => {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(
    atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
};

export interface SharedRequest {
  name?: string;
  request: StoredRequest;
}

/**
 * A request as text for a link. Credentials are taken out first. It is meant for the **fragment** of a URL
 * (`#request=…`), which browsers do not send to a server, so a shared link does not leak through logs.
 */
export function encodeSharedRequest(
  request: StoredRequest,
  name?: string,
): { text: string; tooLong: boolean; redacted: string[] } {
  const cleaned = safe(request);
  const payload: SharedRequest = {
    ...(name ? { name } : {}),
    request: cleaned.request,
  };
  const text = toBase64Url(JSON.stringify(payload));
  return { text, tooLong: text.length > MAX_LINK, redacted: cleaned.redacted };
}

/** The link for a request on a page. */
export const sharedRequestUrl = (pageUrl: string, text: string): string =>
  `${pageUrl.split('#')[0]}#request=${text}`;

/** The request in a link, or nothing when the link is damaged. `#request=…` or the bare text. */
export function decodeSharedRequest(
  hashOrText: string,
): SharedRequest | undefined {
  const text = hashOrText.replace(/^#?(request=)?/, '');
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(text));
    if (!isObject(parsed)) return undefined;
    const request = readRequest(parsed.request);
    if (!request) return undefined;
    return {
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      request: safe(request).request,
    };
  } catch {
    return undefined;
  }
}

/** The variables an environment should be asked for after an import: the names its requests use. */
export const neededVariables = (
  requests: readonly SavedRequest[],
  known: readonly EnvironmentVariable[] = [],
): string[] => {
  const have = new Set(known.map((v) => v.name));
  const names = new Set<string>();
  for (const saved of requests) {
    const texts = [
      saved.request.url,
      ...saved.request.headers.flat(),
      saved.request.body?.text ?? '',
    ];
    for (const text of texts) {
      for (const name of usedVariables(text)) {
        if (!have.has(name)) names.add(name);
      }
    }
  }
  return [...names];
};
