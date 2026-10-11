import { randomBytes } from 'node:crypto';
import type { Actor, Auth } from './auth.ts';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import type { GitProvider, ProviderId } from './git/types.ts';
import { assertRepo } from './git/types.ts';

export interface Site {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  provider: ProviderId;
  repo: string;
  defaultBranch: string;
  /** Folder of the repository that holds `docs.json`; empty when it is the root. */
  docsDir: string;
  liveBuildId?: string;
  createdAt: Date;
}

interface SiteRow {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  provider: ProviderId;
  repo: string;
  default_branch: string;
  docs_dir: string;
  live_build_id: string | null;
  created_at: Date;
  webhook_secret: string;
}
export const toSite = (r: SiteRow): Site => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  slug: r.slug,
  provider: r.provider,
  repo: r.repo,
  defaultBranch: r.default_branch,
  docsDir: r.docs_dir,
  createdAt: r.created_at,
  ...(r.live_build_id && { liveBuildId: r.live_build_id }),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
const cleanDir = (d: string) => d.replace(/^\/+|\/+$/g, '');

export interface SitesOptions {
  db: Db;
  auth: Auth;
  /** The provider for each host. Missing ones make `createSite` refuse that provider. */
  providers: Partial<Record<ProviderId, GitProvider>>;
  clock?: Clock;
}

export function createSites({
  db,
  auth,
  providers,
  clock = systemClock,
}: SitesOptions) {
  async function load(siteId: string): Promise<SiteRow> {
    const { rows } = await db.query<SiteRow>(
      'SELECT * FROM sites WHERE id = $1',
      [siteId],
    );
    if (!rows[0]) throw notFound('No such site.');
    return rows[0];
  }
  return {
    /** The webhook secret is returned here and by `rotateWebhookSecret` only; paste it into the host's webhook settings. */
    async create(
      actor: Actor,
      teamId: string,
      input: {
        name: string;
        provider: ProviderId;
        repo: string;
        defaultBranch?: string;
        docsDir?: string;
      },
    ): Promise<{ site: Site; webhookSecret: string }> {
      await auth.require(actor, teamId, 'site.manage');
      const name = input.name.trim();
      if (!name || name.length > 80)
        throw badRequest('A site name is 1 to 80 characters.');
      const provider = providers[input.provider];
      if (!provider)
        throw badRequest(
          `${input.provider} is not configured on this instance.`,
          'provider_not_configured',
        );
      try {
        assertRepo(input.repo);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      const docsDir = cleanDir(input.docsDir ?? '');
      if (
        docsDir.split('/').some((p) => p === '..' || p === '.') ||
        /[\0\\]/.test(docsDir)
      )
        throw badRequest('docsDir must be a folder inside the repository.');
      // Prove the token can see the repository, and learn its default branch, before saving anything.
      let branch = input.defaultBranch;
      try {
        branch ??= await provider.getDefaultBranch(input.repo);
        await provider.getBranchSha(input.repo, branch);
      } catch (e) {
        throw badRequest(
          `The repository could not be read with the configured token: ${(e as Error).message}`,
          'repo_unreachable',
        );
      }
      const webhookSecret = randomBytes(24).toString('hex');
      return db.transaction(async (tx) => {
        let slug = slugify(name) || 'site';
        const base = slug;
        for (
          let i = 2;
          (await tx.query('SELECT 1 FROM sites WHERE slug = $1', [slug]))
            .rowCount > 0;
          i++
        )
          slug = `${base}-${i}`;
        try {
          const { rows } = await tx.query<SiteRow>(
            `INSERT INTO sites (team_id, name, slug, provider, repo, default_branch, docs_dir, webhook_secret, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              teamId,
              name,
              slug,
              input.provider,
              input.repo,
              branch,
              docsDir,
              webhookSecret,
              clock(),
            ],
          );
          return { site: toSite(rows[0]!), webhookSecret };
        } catch (e) {
          if (/duplicate key/.test((e as Error).message))
            throw conflict(
              'That repository folder is already connected to a site.',
            );
          throw e;
        }
      });
    },

    async list(actor: Actor, teamId: string): Promise<Site[]> {
      await auth.require(actor, teamId, 'site.read');
      return (
        await db.query<SiteRow>(
          'SELECT * FROM sites WHERE team_id = $1 ORDER BY name',
          [teamId],
        )
      ).rows.map(toSite);
    },

    /** A site the actor may act on. Unknown ids and other teams' sites both answer 404 or 403 without detail. */
    async get(
      actor: Actor,
      siteId: string,
      action: Parameters<Auth['require']>[2] = 'site.read',
    ): Promise<Site> {
      const row = await load(siteId);
      await auth.require(actor, row.team_id, action);
      return toSite(row);
    },

    async rotateWebhookSecret(actor: Actor, siteId: string): Promise<string> {
      const row = await load(siteId);
      await auth.require(actor, row.team_id, 'site.manage');
      const secret = randomBytes(24).toString('hex');
      await db.query('UPDATE sites SET webhook_secret = $2 WHERE id = $1', [
        siteId,
        secret,
      ]);
      return secret;
    },

    async remove(actor: Actor, siteId: string): Promise<void> {
      const row = await load(siteId);
      await auth.require(actor, row.team_id, 'site.manage');
      await db.query('DELETE FROM sites WHERE id = $1', [siteId]);
    },

    /** Internal: services that hold no actor (webhooks, workers, the agent) read sites directly. */
    async internal(siteId: string): Promise<Site & { webhookSecret: string }> {
      const row = await load(siteId);
      return { ...toSite(row), webhookSecret: row.webhook_secret };
    },
    async bySlug(slug: string): Promise<Site | undefined> {
      const { rows } = await db.query<SiteRow>(
        'SELECT * FROM sites WHERE slug = $1',
        [slug],
      );
      return rows[0] ? toSite(rows[0]) : undefined;
    },
  };
}

export type Sites = ReturnType<typeof createSites>;
