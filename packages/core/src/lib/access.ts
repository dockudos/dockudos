import type { DocsConfig } from './config.ts';

export type AccessRule = DocsConfig['access']['rules'][number];

/** Make a request path comparable: no query, repeated slashes collapsed, no trailing slash. */
export function normalizePath(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined; // malformed escapes: callers treat this as "protect it"
  }
  const collapsed = (
    '/' +
    decoded
      .split('/')
      .filter((s) => s !== '')
      .join('/')
  ).replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

/**
 * Does a pattern cover a path? `/a` is that path only, `/a/*` is one level below it, and `/a/**` is
 * `/a` and everything below it. A `*` stands for a whole segment.
 */
export function matchesPattern(pattern: string, pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === undefined) return true;
  const open = pattern.endsWith('/**');
  const base = normalizePath(
    open ? pattern.slice(0, -3) || '/' : pattern,
  ) as string;
  const want = base === '/' ? [] : base.slice(1).split('/');
  const have = path === '/' ? [] : path.slice(1).split('/');
  if (open ? have.length < want.length : have.length !== want.length)
    return false;
  return want.every((segment, i) => segment === '*' || segment === have[i]);
}

/**
 * The rule that decides a path: the first one listed that covers it. A path that cannot be read
 * (broken escapes) gets the first rule, so it is never let through by accident.
 */
export function findAccessRule(
  rules: readonly AccessRule[],
  pathname: string,
): AccessRule | undefined {
  if (normalizePath(pathname) === undefined) return rules[0];
  return rules.find((rule) =>
    rule.paths.some((p) => matchesPattern(p, pathname)),
  );
}

/** `Authorization: Basic …` as a user and password. */
export function parseBasicAuth(
  header: string | null | undefined,
): { user: string; password: string } | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header ?? '');
  if (!match) return undefined;
  let text: string;
  try {
    text = new TextDecoder().decode(
      Uint8Array.from(
        atob((match[1] as string).replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      ),
    );
  } catch {
    return undefined;
  }
  const colon = text.indexOf(':');
  if (colon < 0) return undefined;
  return { user: text.slice(0, colon), password: text.slice(colon + 1) };
}

export const bearerToken = (
  header: string | null | undefined,
): string | undefined => /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1];

/**
 * Compare two strings without stopping at the first difference, so response time does not reveal
 * how much of a guess was right. Lengths are not hidden.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** `user:pass` entries separated by commas or new lines (the value of `DOCKUDOS_BASIC_AUTH`). */
export function parseCredentials(
  value: string | undefined,
): { user: string; password: string }[] {
  return (value ?? '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const colon = entry.indexOf(':');
      return colon > 0 && colon < entry.length - 1
        ? [{ user: entry.slice(0, colon), password: entry.slice(colon + 1) }]
        : [];
    });
}

/** Does the Basic header match one of the credentials? Checks every entry, whatever the outcome. */
export function checkBasic(
  header: string | null | undefined,
  credentials: readonly { user: string; password: string }[],
): boolean {
  const given = parseBasicAuth(header);
  let ok = false;
  for (const c of credentials) {
    const userOk = safeEqual(given?.user ?? '', c.user);
    const passOk = safeEqual(given?.password ?? '', c.password);
    if (given && userOk && passOk) ok = true;
  }
  return ok;
}

/** Does the bearer token (or the fallback header) match one of the tokens? */
export function checkToken(
  token: string | null | undefined,
  tokens: readonly string[],
): boolean {
  let ok = false;
  for (const t of tokens) if (token && safeEqual(token, t)) ok = true;
  return ok;
}

/** Tokens from `DOCKUDOS_TOKEN`: separated by commas or new lines. */
export const parseTokens = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 8);
