import type { AccessRule } from './access.ts';

/** A signed-in user, as far as access rules care: who they are and what they may be. */
export interface Principal {
  /** The identity provider's stable id for the user. */
  sub: string;
  email?: string;
  name?: string;
  roles: string[];
  groups: string[];
}

export type LoginDecision = 'allow' | 'sign-in' | 'forbidden';

/**
 * Decide a `require: "login"` rule for a user. Denies by default: no user means "sign in"; a rule that names
 * roles or groups lets a user in only when one of them matches; a rule that names neither lets any signed-in
 * user in. Matching is exact and case-sensitive.
 */
export function decideLogin(
  rule: Pick<AccessRule, 'roles' | 'groups'>,
  principal: Principal | undefined,
): LoginDecision {
  if (!principal) return 'sign-in';
  const { roles, groups } = rule;
  if (!roles && !groups) return 'allow';
  if (roles?.some((r) => principal.roles.includes(r))) return 'allow';
  if (groups?.some((g) => principal.groups.includes(g))) return 'allow';
  return 'forbidden';
}

/** Read a claim by a dotted name (`realm_access.roles`) as a list of strings. A single string becomes a list. */
export function claimList(
  claims: Record<string, unknown>,
  name: string,
): string[] {
  // A claim whose own name has dots (Auth0 namespaces like `https://acme.com/roles`) wins over a path.
  let value: unknown = name in claims ? claims[name] : undefined;
  if (value === undefined) {
    value = claims;
    for (const part of name.split('.')) {
      if (value && typeof value === 'object' && part in (value as object))
        value = (value as Record<string, unknown>)[part];
      else {
        value = undefined;
        break;
      }
    }
  }
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === 'string' && v !== '');
  return [];
}

/** The principal an ID token's claims describe. Throws when there is no `sub`. */
export function principalFromClaims(
  claims: Record<string, unknown>,
  { rolesClaim = 'roles', groupsClaim = 'groups' } = {},
): Principal {
  const sub = claims['sub'];
  if (typeof sub !== 'string' || !sub)
    throw new Error('The ID token has no "sub".');
  const text = (key: string) =>
    typeof claims[key] === 'string' && claims[key]
      ? (claims[key] as string)
      : undefined;
  const email = text('email');
  const name = text('name');
  return {
    sub,
    ...(email && { email }),
    ...(name && { name }),
    roles: claimList(claims, rolesClaim),
    groups: claimList(claims, groupsClaim),
  };
}

/**
 * A place to send a reader after signing in, made safe: only a path on this site. Anything else (another
 * origin, `//host`, backslashes, control characters) becomes `/`, so the sign-in page cannot be used to
 * redirect to a stranger's site.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2000) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'http://site.invalid');
    if (url.origin !== 'http://site.invalid') return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}
