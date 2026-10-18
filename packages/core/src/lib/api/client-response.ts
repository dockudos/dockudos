/**
 * Responses the reader kept, and comparing two of them. Pure functions: the client stores what is here and shows the
 * diff, but nothing in this file reads storage or the network.
 */

import {
  CLIENT_LIMITS,
  CLIENT_SCHEMA_VERSION,
  isObject,
  newId,
  trimName,
} from './client.ts';

/** Limits for kept responses, so a big answer cannot fill a reader's storage. */
export const EXAMPLE_LIMITS = {
  /** Per saved request. */
  perRequest: 10,
  /** Of a kept body, in characters. */
  bodyLength: 100_000,
  /** Lines a side may have before a comparison is refused. */
  diffLines: 4_000,
} as const;

export interface ResponseExample {
  id: string;
  /** The saved request it answers, when it came from one. */
  requestId?: string;
  name: string;
  at: number;
  status: number;
  statusText?: string;
  headers: [string, string][];
  body: string;
  /** The body was longer than the limit and was cut. */
  truncated?: boolean;
  v: number;
}

export interface ExampleInput {
  requestId?: string;
  name: string;
  status: number;
  statusText?: string;
  headers?: [string, string][];
  body: string;
}

/** A response to keep, cut to the limits. */
export function makeExample({
  requestId,
  name,
  status,
  statusText,
  headers = [],
  body,
}: ExampleInput): ResponseExample {
  const text = body.slice(0, EXAMPLE_LIMITS.bodyLength);
  return {
    id: newId(),
    ...(requestId ? { requestId } : {}),
    name: trimName(name, `${status}`),
    at: Date.now(),
    status,
    ...(statusText ? { statusText } : {}),
    headers: headers.slice(0, CLIENT_LIMITS.headers),
    body: text,
    ...(text.length < body.length ? { truncated: true as const } : {}),
    v: CLIENT_SCHEMA_VERSION,
  };
}

/** A kept response as this version understands it; one from a newer version is left alone. */
export function migrateResponseExample(
  raw: unknown,
): ResponseExample | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.v === 'number' && raw.v > CLIENT_SCHEMA_VERSION) return undefined;
  if (typeof raw.status !== 'number') return undefined;
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    ...(typeof raw.requestId === 'string' ? { requestId: raw.requestId } : {}),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.slice(0, CLIENT_LIMITS.nameLength)
        : `${raw.status}`,
    at: typeof raw.at === 'number' ? raw.at : Date.now(),
    status: raw.status,
    ...(typeof raw.statusText === 'string' ? { statusText: raw.statusText } : {}),
    headers: Array.isArray(raw.headers)
      ? raw.headers
          .filter(
            (h): h is [string, string] =>
              Array.isArray(h) && typeof h[0] === 'string',
          )
          .map(([k, v]) => [k, typeof v === 'string' ? v : ''] as [string, string])
          .slice(0, CLIENT_LIMITS.headers)
      : [],
    body:
      typeof raw.body === 'string'
        ? raw.body.slice(0, EXAMPLE_LIMITS.bodyLength)
        : '',
    ...(raw.truncated === true ? { truncated: true as const } : {}),
    v: CLIENT_SCHEMA_VERSION,
  };
}

export type DiffMark = 'same' | 'added' | 'removed';

export interface DiffLine {
  mark: DiffMark;
  text: string;
  /** Line number on the left, where there is one. */
  left?: number;
  /** Line number on the right, where there is one. */
  right?: number;
}

export interface Diff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** One side was too long to compare line by line. */
  tooLong?: boolean;
}

/**
 * The lines of `before` and `after` side by side: a longest-common-subsequence diff, which is what a reader expects
 * when two answers differ by a field or two. Both sides are read as text; the client pretty-prints JSON first, so a
 * change inside an object shows as the line it is on.
 */
export function diffLines(before: string, after: string): Diff {
  const left = before.split('\n');
  const right = after.split('\n');
  if (
    left.length > EXAMPLE_LIMITS.diffLines ||
    right.length > EXAMPLE_LIMITS.diffLines
  ) {
    return { lines: [], added: 0, removed: 0, tooLong: true };
  }

  // table[i][j] = length of the longest common subsequence of left[i:] and right[j:]
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      (table[i] as number[])[j] =
        left[i] === right[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (table[i + 1] as number[])[j] as number,
              (table[i] as number[])[j + 1] as number,
            );
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ mark: 'same', text: left[i] as string, left: i + 1, right: j + 1 });
      i += 1;
      j += 1;
    } else if (
      ((table[i + 1] as number[])[j] as number) >=
      ((table[i] as number[])[j + 1] as number)
    ) {
      lines.push({ mark: 'removed', text: left[i] as string, left: i + 1 });
      removed += 1;
      i += 1;
    } else {
      lines.push({ mark: 'added', text: right[j] as string, right: j + 1 });
      added += 1;
      j += 1;
    }
  }
  for (; i < left.length; i += 1) {
    lines.push({ mark: 'removed', text: left[i] as string, left: i + 1 });
    removed += 1;
  }
  for (; j < right.length; j += 1) {
    lines.push({ mark: 'added', text: right[j] as string, right: j + 1 });
    added += 1;
  }
  return { lines, added, removed };
}
