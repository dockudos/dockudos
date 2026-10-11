import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Principal, principalFromClaims, signToken, verifyToken } from '@dockudos/core';
import { type Clock, systemClock } from './clock.ts';
import type { Db, Queryable } from './db.ts';
import { badRequest, conflict, forbidden, notFound, PlatformError, unauthorized } from './errors.ts';
import { type Action, can, isTeamRole, rank, type TeamRole } from './permissions.ts';

export interface User {
  id: string;
  sub: string;
  email?: string;
  name?: string;
  instanceRole: 'owner' | 'member';
  roles: string[];
  groups: string[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
}

export interface ApiKeyInfo {
  id: string;
  teamId: string;
  name: string;
  prefix: string;
  role: Exclude<TeamRole, 'owner'>;
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
}

/** Who is making a request: a signed-in person, or an API key. */
export type Actor =
  | { type: 'user'; user: User }
  | { type: 'key'; key: ApiKeyInfo };

/** The cookie name Phase 4 private docs read, so one sign-in can open both the platform and the docs. */
export const DOCS_SESSION_COOKIE = 'dockudos_session';
export const PLATFORM_SESSION_COOKIE = 'dockudos_platform';

const KEY_PATTERN = /^dkd_([0-9a-f]{8})_([A-Za-z0-9_-]{32,})$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

interface UserRow {
  id: string; sub: string; email: string | null; name: string | null;
  instance_role: 'owner' | 'member'; roles: string[]; groups: string[];
}
const toUser = (r: UserRow): User => ({
  id: r.id, sub: r.sub,
  ...(r.email && { email: r.email }),
  ...(r.name && { name: r.name }),
  instanceRole: r.instance_role, roles: r.roles, groups: r.groups,
});

export interface AuthOptions {
  db: Db;
  /** Signs sessions. 32+ characters. */
  secret: string;
  clock?: Clock;
  /** The first sign-in with this email owns the instance. Without it, the very first user does. */
  adminEmail?: string;
  sessionHours?: number;
}

export function createAuth({ db, secret, clock = systemClock, adminEmail, sessionHours = 12 }: AuthOptions) {
  const nowSec = () => Math.floor(clock().getTime() / 1000);

  async function upsertUser(principal: Principal): Promise<User> {
    const email = principal.email?.toLowerCase();
    return db.transaction(async (tx) => {
      const existing = await tx.query<UserRow>('SELECT * FROM users WHERE sub = $1 FOR UPDATE', [principal.sub]);
      if (existing.rows[0]) {
        const { rows } = await tx.query<UserRow>(
          `UPDATE users SET email = $2, name = $3, roles = $4, groups = $5, last_login_at = $6 WHERE id = $1 RETURNING *`,
          [existing.rows[0].id, email ?? null, principal.name ?? null, principal.roles, principal.groups, clock()],
        );
        return toUser(rows[0]!);
      }
      const count = Number((await tx.query<{ n: string }>('SELECT count(*) AS n FROM users')).rows[0]!.n);
      // With an admin email set, only that address becomes owner (and only if its provider verified it: the
      // caller passes `emailVerified` through `principalFromClaims` checks). Otherwise the first user does.
      const owner = adminEmail ? email === adminEmail : count === 0;
      const { rows } = await tx.query<UserRow>(
        `INSERT INTO users (sub, email, name, instance_role, roles, groups, created_at, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
        [principal.sub, email ?? null, principal.name ?? null, owner ? 'owner' : 'member', principal.roles, principal.groups, clock()],
      );
      return toUser(rows[0]!);
    });
  }

  async function getUser(id: string): Promise<User | undefined> {
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  // --- sessions -----------------------------------------------------------------------------------------------
  const sessionToken = (user: User) =>
    signToken({ uid: user.id }, secret, { purpose: 'platform-session', ttlSeconds: sessionHours * 3600, now: nowSec() });

  async function userFromSession(token: string | undefined): Promise<User | undefined> {
    const data = await verifyToken<{ uid?: string }>(token, secret, { purpose: 'platform-session', now: nowSec() });
    return typeof data?.uid === 'string' ? getUser(data.uid) : undefined;
  }

  // --- teams and roles ----------------------------------------------------------------------------------------
  async function roleOf(tx: Queryable, teamId: string, userId: string) {
    const { rows } = await tx.query<{ role: TeamRole }>('SELECT role FROM memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    return rows[0]?.role;
  }

  /** The role an actor holds in a team. The instance owner is an owner of every team; a key only in its own. */
  async function roleIn(actor: Actor, teamId: string): Promise<TeamRole | undefined> {
    if (actor.type === 'key') return actor.key.teamId === teamId ? actor.key.role : undefined;
    if (actor.user.instanceRole === 'owner') return 'owner';
    return roleOf(db, teamId, actor.user.id);
  }

  /** Throw 403 unless the actor may do `action` in the team. Unknown teams look the same as forbidden ones. */
  async function require(actor: Actor, teamId: string, action: Action): Promise<TeamRole> {
    const role = await roleIn(actor, teamId);
    if (!can(role, action)) throw forbidden();
    return role!;
  }

  async function createTeam(actor: Actor, name: string): Promise<Team> {
    if (actor.type !== 'user') throw forbidden('API keys cannot create teams.');
    const clean = name.trim();
    if (!clean || clean.length > 80) throw badRequest('A team name is 1 to 80 characters.');
    const base = slugify(clean) || 'team';
    return db.transaction(async (tx) => {
      let slug = base;
      for (let i = 2; (await tx.query('SELECT 1 FROM teams WHERE slug = $1', [slug])).rowCount > 0; i++) slug = `${base}-${i}`;
      const { rows } = await tx.query<Team & { id: string }>(
        'INSERT INTO teams (name, slug, created_at) VALUES ($1,$2,$3) RETURNING id, name, slug', [clean, slug, clock()]);
      await tx.query("INSERT INTO memberships (team_id, user_id, role) VALUES ($1,$2,'owner')", [rows[0]!.id, actor.user.id]);
      return rows[0]!;
    });
  }

  async function listTeams(actor: Actor): Promise<(Team & { role: TeamRole })[]> {
    if (actor.type === 'key') {
      const { rows } = await db.query<Team>('SELECT id, name, slug FROM teams WHERE id = $1', [actor.key.teamId]);
      return rows.map((t) => ({ ...t, role: actor.key.role }));
    }
    if (actor.user.instanceRole === 'owner') {
      const { rows } = await db.query<Team>('SELECT id, name, slug FROM teams ORDER BY name');
      return rows.map((t) => ({ ...t, role: 'owner' as const }));
    }
    const { rows } = await db.query<Team & { role: TeamRole }>(
      'SELECT t.id, t.name, t.slug, m.role FROM teams t JOIN memberships m ON m.team_id = t.id WHERE m.user_id = $1 ORDER BY t.name',
      [actor.user.id]);
    return rows;
  }

  async function listMembers(actor: Actor, teamId: string) {
    await require(actor, teamId, 'site.read');
    const { rows } = await db.query<{ user_id: string; email: string | null; name: string | null; role: TeamRole }>(
      'SELECT m.user_id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY u.email',
      [teamId]);
    return rows.map((r) => ({ userId: r.user_id, email: r.email ?? undefined, name: r.name ?? undefined, role: r.role }));
  }

  /** Nobody may hand out a role above their own, change someone above them, or leave a team with no owner. */
  async function setMember(actor: Actor, teamId: string, email: string, role: TeamRole): Promise<void> {
    const mine = await require(actor, teamId, 'members.manage');
    if (!isTeamRole(role)) throw badRequest('Unknown role.');
    if (rank(role) > rank(mine)) throw forbidden('You cannot grant a role above your own.');
    await db.transaction(async (tx) => {
      const found = await tx.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
      if (!found.rows[0]) throw notFound('No user with that email has signed in yet. Ask them to sign in once first.');
      const userId = found.rows[0].id;
      const current = await roleOf(tx, teamId, userId);
      if (current && rank(current) > rank(mine)) throw forbidden('You cannot change someone above your own role.');
      if (current === 'owner' && role !== 'owner') await assertAnotherOwner(tx, teamId, userId);
      await tx.query(
        'INSERT INTO memberships (team_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role',
        [teamId, userId, role]);
    });
  }

  async function assertAnotherOwner(tx: Queryable, teamId: string, leaving: string) {
    const others = await tx.query("SELECT 1 FROM memberships WHERE team_id = $1 AND role = 'owner' AND user_id <> $2", [teamId, leaving]);
    if (others.rowCount === 0) throw conflict('A team needs at least one owner.', 'last_owner');
  }

  async function removeMember(actor: Actor, teamId: string, userId: string): Promise<void> {
    const isSelf = actor.type === 'user' && actor.user.id === userId;
    const mine = isSelf ? await roleIn(actor, teamId) : await require(actor, teamId, 'members.manage');
    if (!mine) throw forbidden();
    await db.transaction(async (tx) => {
      const current = await roleOf(tx, teamId, userId);
      if (!current) throw notFound('Not a member.');
      if (rank(current) > rank(mine)) throw forbidden('You cannot remove someone above your own role.');
      if (current === 'owner') await assertAnotherOwner(tx, teamId, userId);
      await tx.query('DELETE FROM memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    });
  }

  // --- API keys -----------------------------------------------------------------------------------------------
  interface KeyRow {
    id: string; team_id: string; name: string; prefix: string; hash: string; role: ApiKeyInfo['role'];
    created_at: Date; expires_at: Date | null; revoked_at: Date | null; last_used_at: Date | null;
  }
  const toKey = (r: KeyRow): ApiKeyInfo => ({
    id: r.id, teamId: r.team_id, name: r.name, prefix: r.prefix, role: r.role, createdAt: r.created_at,
    ...(r.expires_at && { expiresAt: r.expires_at }),
    ...(r.revoked_at && { revokedAt: r.revoked_at }),
    ...(r.last_used_at && { lastUsedAt: r.last_used_at }),
  });

  /** The secret is returned once, here. Only its hash is stored, so a database leak does not leak working keys. */
  async function createApiKey(
    actor: Actor, teamId: string, name: string, role: ApiKeyInfo['role'] = 'editor', expiresInDays?: number,
  ): Promise<{ key: ApiKeyInfo; secret: string }> {
    const mine = await require(actor, teamId, 'keys.manage');
    if (actor.type === 'key') throw forbidden('API keys cannot create API keys.');
    if (!['viewer', 'editor', 'admin'].includes(role)) throw badRequest('A key role is viewer, editor or admin.');
    if (rank(role) > rank(mine)) throw forbidden('A key cannot have a role above yours.');
    const clean = name.trim();
    if (!clean || clean.length > 80) throw badRequest('A key name is 1 to 80 characters.');
    const prefix = randomBytes(4).toString('hex');
    const secretPart = randomBytes(24).toString('base64url');
    const { rows } = await db.query<KeyRow>(
      `INSERT INTO api_keys (team_id, name, prefix, hash, role, created_by, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [teamId, clean, prefix, sha256(secretPart), role, actor.user.id, clock(),
        expiresInDays ? new Date(clock().getTime() + expiresInDays * 86_400_000) : null]);
    return { key: toKey(rows[0]!), secret: `dkd_${prefix}_${secretPart}` };
  }

  async function listApiKeys(actor: Actor, teamId: string): Promise<ApiKeyInfo[]> {
    await require(actor, teamId, 'keys.manage');
    const { rows } = await db.query<KeyRow>('SELECT * FROM api_keys WHERE team_id = $1 ORDER BY created_at DESC', [teamId]);
    return rows.map(toKey);
  }

  async function revokeApiKey(actor: Actor, teamId: string, keyId: string): Promise<void> {
    await require(actor, teamId, 'keys.manage');
    const r = await db.query('UPDATE api_keys SET revoked_at = $3 WHERE id = $1 AND team_id = $2 AND revoked_at IS NULL', [keyId, teamId, clock()]);
    if (r.rowCount === 0) throw notFound('No such active key.');
  }

  /** Check a presented key. Wrong, expired and revoked keys all look the same to the caller. */
  async function authenticateApiKey(presented: string | undefined): Promise<ApiKeyInfo | undefined> {
    const m = KEY_PATTERN.exec(presented ?? '');
    if (!m) return undefined;
    const { rows } = await db.query<KeyRow>('SELECT * FROM api_keys WHERE prefix = $1', [m[1]]);
    const row = rows[0];
    const given = Buffer.from(sha256(m[2]!));
    const want = Buffer.from(row?.hash ?? sha256('no such key'));
    const same = given.length === want.length && timingSafeEqual(given, want);
    if (!row || !same || row.revoked_at || (row.expires_at && row.expires_at <= clock())) return undefined;
    // Last-used is a convenience; do not make the request wait on it or fail because of it.
    void db.query('UPDATE api_keys SET last_used_at = $2 WHERE id = $1', [row.id, clock()]).catch(() => undefined);
    return toKey(row);
  }

  /** Who is calling? Bearer API key first, then the session cookie. */
  async function actorFromRequest(request: Request): Promise<Actor | undefined> {
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer) {
      const key = await authenticateApiKey(bearer);
      return key ? { type: 'key', key } : undefined;
    }
    const cookie = new RegExp(`(?:^|;\\s*)${PLATFORM_SESSION_COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
    const user = await userFromSession(cookie);
    return user ? { type: 'user', user } : undefined;
  }

  async function requireActor(request: Request): Promise<Actor> {
    const actor = await actorFromRequest(request);
    if (!actor) throw unauthorized();
    return actor;
  }

  // --- bridge to Phase 4 private docs --------------------------------------------------------------------------
  /**
   * The principal a docs site sees for this actor. Roles carry the identity provider's roles plus `team:<slug>:<role>`;
   * groups carry the provider's groups plus `team:<slug>`. So a `docs.json` rule such as
   * `{ "require": "login", "groups": ["team:acme"] }` admits exactly the members of the Acme team.
   */
  async function principalFor(actor: Actor): Promise<Principal> {
    if (actor.type === 'key') {
      const { rows } = await db.query<{ slug: string }>('SELECT slug FROM teams WHERE id = $1', [actor.key.teamId]);
      const slug = rows[0]!.slug;
      return { sub: `key:${actor.key.id}`, name: actor.key.name, roles: [`team:${slug}:${actor.key.role}`], groups: [`team:${slug}`] };
    }
    const teams = await listTeams(actor);
    const { user } = actor;
    return {
      sub: user.sub, ...(user.email && { email: user.email }), ...(user.name && { name: user.name }),
      roles: [...new Set([...user.roles, ...(user.instanceRole === 'owner' ? ['instance-owner'] : []), ...teams.map((t) => `team:${t.slug}:${t.role}`)])],
      groups: [...new Set([...user.groups, ...teams.map((t) => `team:${t.slug}`)])],
    };
  }

  /** A `Set-Cookie`-ready docs session value, readable by `@dockudos/next`'s `readSession` with the same secret. */
  async function docsSession(principal: Principal, docsSecret: string, hours = 12): Promise<string> {
    return signToken({ ...principal }, docsSecret, { purpose: 'session', ttlSeconds: hours * 3600, now: nowSec() });
  }

  /**
   * For operators with database access (the `bootstrap` command): make sure a team exists and mint an admin API key for
   * it, with no signed-in person involved. This is how a headless install, or a smoke test, gets its first credentials.
   */
  async function bootstrap(teamName: string, keyName = 'bootstrap'): Promise<{ team: Team; secret: string }> {
    const clean = teamName.trim();
    if (!clean || clean.length > 80) throw badRequest('A team name is 1 to 80 characters.');
    const base = slugify(clean) || 'team';
    return db.transaction(async (tx) => {
      const existing = await tx.query<Team>('SELECT id, name, slug FROM teams WHERE slug = $1', [base]);
      const team = existing.rows[0] ?? (await tx.query<Team>('INSERT INTO teams (name, slug, created_at) VALUES ($1,$2,$3) RETURNING id, name, slug', [clean, base, clock()])).rows[0]!;
      const prefix = randomBytes(4).toString('hex');
      const secretPart = randomBytes(24).toString('base64url');
      await tx.query(
        `INSERT INTO api_keys (team_id, name, prefix, hash, role, created_at) VALUES ($1,$2,$3,$4,'admin',$5)`,
        [team.id, keyName, prefix, sha256(secretPart), clock()]);
      return { team, secret: `dkd_${prefix}_${secretPart}` };
    });
  }

  return {
    bootstrap,
    upsertUser, getUser, sessionToken, userFromSession,
    createTeam, listTeams, listMembers, setMember, removeMember, roleIn, require,
    createApiKey, listApiKeys, revokeApiKey, authenticateApiKey,
    actorFromRequest, requireActor, principalFor, docsSession,
    /** For the OIDC callback: turn verified claims into a user. */
    userFromClaims: (claims: Record<string, unknown>, o?: { rolesClaim?: string; groupsClaim?: string }) => {
      const principal = principalFromClaims(claims, o);
      // An address the provider has not verified proves nothing: never let it decide who owns the instance.
      if (claims['email_verified'] === false) delete principal.email;
      return upsertUser(principal);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
export { PlatformError };
