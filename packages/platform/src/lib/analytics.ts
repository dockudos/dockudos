import type { Actor, Auth } from './auth.ts';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { badRequest } from './errors.ts';
import {
  classifyTraffic,
  cleanPath,
  dailyVisitor,
  referrerHost,
  scrubText,
} from './privacy.ts';
import type { Sites } from './sites.ts';

export type EventKind = 'pageview' | 'search' | 'feedback' | 'assistant';

export interface IngestEvent {
  kind: EventKind;
  path?: string;
  /** For `search`: the words typed. For `assistant`: the question (kept only when conversation logging is on). */
  query?: string;
  /** For `search`: how many results were shown. Zero marks a failed search. */
  results?: number;
  /** For `feedback`: `up` or `down`. For `assistant`: `answered` or `unanswered`. */
  value?: string;
  referrer?: string;
  /** For `assistant`: the answer text and cited paths, kept only when conversation logging is on. */
  answer?: string;
  cited?: string[];
  /** Set by the docs site's own server (MCP, llms.txt) so these requests count as AI traffic. */
  traffic?: 'ai';
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
  /** `Sec-GPC` / `DNT` were set: the visitor asked not to be counted. */
  doNotTrack?: boolean;
}

export interface AnalyticsOptions {
  db: Db;
  sites: Sites;
  auth: Auth;
  /** Keys the daily visitor hash. */
  secret: string;
  clock?: Clock;
  /** Default for sites that have not chosen. */
  defaults?: {
    logConversations: boolean;
    retentionDays: number;
    conversationRetentionDays: number;
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const VALUES: Record<EventKind, readonly string[] | undefined> = {
  pageview: undefined,
  search: undefined,
  feedback: ['up', 'down'],
  assistant: ['answered', 'unanswered'],
};

export interface Range {
  from: string;
  to: string;
}

export function createAnalytics({
  db,
  sites,
  auth,
  secret,
  clock = systemClock,
  defaults = {
    logConversations: false,
    retentionDays: 90,
    conversationRetentionDays: 30,
  },
}: AnalyticsOptions) {
  async function settings(siteId: string) {
    const { rows } = await db.query<{
      log_conversations: boolean;
      conversation_retention_days: number;
      event_retention_days: number;
    }>(
      'SELECT log_conversations, conversation_retention_days, event_retention_days FROM site_settings WHERE site_id = $1',
      [siteId],
    );
    const r = rows[0];
    return {
      logConversations: r?.log_conversations ?? defaults.logConversations,
      conversationRetentionDays:
        r?.conversation_retention_days ?? defaults.conversationRetentionDays,
      retentionDays: r?.event_retention_days ?? defaults.retentionDays,
    };
  }

  function range(r?: Partial<Range>): Range {
    const to = r?.to ?? day(clock());
    const from =
      r?.from ??
      day(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86_400_000));
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    )
      throw badRequest('Use from and to as YYYY-MM-DD, from not after to.');
    if (
      new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime() >
      366 * 86_400_000
    )
      throw badRequest('At most one year at a time.');
    return { from, to };
  }

  return {
    /**
     * Record one event. Returns what happened: `recorded`, or `skipped` with the reason. Nothing identifying is stored:
     * no address, no user agent, no cookie id; the visitor is a one-day hash, search text is scrubbed, referrers keep
     * only the host.
     */
    async ingest(
      siteId: string,
      e: IngestEvent,
      ctx: RequestContext = {},
    ): Promise<{ status: 'recorded' } | { status: 'skipped'; reason: string }> {
      if (ctx.doNotTrack) return { status: 'skipped', reason: 'do-not-track' };
      if (!(e.kind in VALUES)) throw badRequest('Unknown event kind.');
      const allowed = VALUES[e.kind];
      if (allowed && (!e.value || !allowed.includes(e.value)))
        throw badRequest(`${e.kind} value must be ${allowed.join(' or ')}.`);
      if (
        e.kind === 'search' &&
        (typeof e.query !== 'string' ||
          !Number.isInteger(e.results) ||
          (e.results as number) < 0)
      )
        throw badRequest('A search event needs query and results.');
      if (
        (e.kind === 'pageview' || e.kind === 'feedback') &&
        !cleanPath(e.path)
      )
        throw badRequest('A path starting with / is required.');
      const now = clock();
      const today = day(now);
      const cls = classifyTraffic(ctx.userAgent, e.traffic);
      const query = e.kind === 'search' ? scrubText(e.query ?? '') : null;
      if (e.kind === 'search' && !query)
        return { status: 'skipped', reason: 'empty-query' };
      await db.query(
        `INSERT INTO analytics_events (site_id, kind, day, ts, path, visitor, traffic, agent, query, results, value, referrer_host)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          siteId,
          e.kind,
          today,
          now,
          cleanPath(e.path) ?? null,
          dailyVisitor(secret, siteId, ctx.ip, ctx.userAgent, today),
          cls.traffic,
          cls.agent ?? null,
          query,
          e.kind === 'search' ? e.results : null,
          e.value ?? null,
          referrerHost(e.referrer) ?? null,
        ],
      );
      if (
        e.kind === 'assistant' &&
        e.query &&
        (await settings(siteId)).logConversations
      ) {
        await db.query(
          'INSERT INTO conversations (site_id, question, answer, answered, cited_paths, ts) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            siteId,
            scrubText(e.query, 500),
            e.answer ? scrubText(e.answer, 4000) : null,
            e.value === 'answered',
            (e.cited ?? [])
              .map((p) => cleanPath(p))
              .filter((p): p is string => !!p)
              .slice(0, 20),
            now,
          ],
        );
      }
      return { status: 'recorded' };
    },

    settings,
    async updateSettings(
      actor: Actor,
      siteId: string,
      input: {
        logConversations?: boolean;
        conversationRetentionDays?: number;
        eventRetentionDays?: number;
      },
    ) {
      await sites.get(actor, siteId, 'site.manage');
      const cur = await settings(siteId);
      const conv =
        input.conversationRetentionDays ?? cur.conversationRetentionDays;
      const ev = input.eventRetentionDays ?? cur.retentionDays;
      if (
        !Number.isInteger(conv) ||
        conv < 1 ||
        conv > 3650 ||
        !Number.isInteger(ev) ||
        ev < 1 ||
        ev > 3650
      )
        throw badRequest('Retention is 1 to 3650 days.');
      await db.query(
        `INSERT INTO site_settings (site_id, log_conversations, conversation_retention_days, event_retention_days) VALUES ($1,$2,$3,$4)
         ON CONFLICT (site_id) DO UPDATE SET log_conversations = EXCLUDED.log_conversations,
           conversation_retention_days = EXCLUDED.conversation_retention_days, event_retention_days = EXCLUDED.event_retention_days`,
        [siteId, input.logConversations ?? cur.logConversations, conv, ev],
      );
      // Turning logging off also forgets what was logged: nobody should keep text they decided not to collect.
      if (input.logConversations === false)
        await db.query('DELETE FROM conversations WHERE site_id = $1', [
          siteId,
        ]);
    },

    /** Delete events and conversations past their retention. Run daily. */
    async purge(): Promise<{ events: number; conversations: number }> {
      const now = clock();
      const events = await db.query(
        `DELETE FROM analytics_events e USING (SELECT s.id AS site_id, COALESCE(ss.event_retention_days, $2) AS days FROM sites s LEFT JOIN site_settings ss ON ss.site_id = s.id) r
         WHERE e.site_id = r.site_id AND e.ts < $1::timestamptz - make_interval(days => r.days)`,
        [now, defaults.retentionDays],
      );
      const conversations = await db.query(
        `DELETE FROM conversations c USING (SELECT s.id AS site_id, COALESCE(ss.conversation_retention_days, $2) AS days FROM sites s LEFT JOIN site_settings ss ON ss.site_id = s.id) r
         WHERE c.site_id = r.site_id AND c.ts < $1::timestamptz - make_interval(days => r.days)`,
        [now, defaults.conversationRetentionDays],
      );
      return { events: events.rowCount, conversations: conversations.rowCount };
    },

    /** Everything a dashboard shows, in one call. */
    async dashboard(
      actor: Actor,
      siteId: string,
      r?: Partial<Range>,
      limit = 10,
    ) {
      const site = await sites.get(actor, siteId, 'analytics.read');
      await auth.require(actor, site.teamId, 'analytics.read');
      const { from, to } = range(r);
      const n = Math.min(Math.max(limit, 1), 100);
      const q = async <T>(sql: string, extra: unknown[] = []) =>
        (await db.query<T>(sql, [siteId, from, to, ...extra])).rows;
      const base = `FROM analytics_events WHERE site_id = $1 AND day BETWEEN $2 AND $3`;

      const [
        series,
        traffic,
        agents,
        topPages,
        topSearches,
        zeroResults,
        feedback,
        assistant,
        referrers,
      ] = await Promise.all([
        q<{ day: Date | string; views: string; visitors: string }>(
          `SELECT day, count(*) AS views, count(DISTINCT visitor) AS visitors ${base} AND kind = 'pageview' AND traffic = 'human' GROUP BY day ORDER BY day`,
        ),
        q<{ traffic: string; views: string }>(
          `SELECT traffic, count(*) AS views ${base} AND kind = 'pageview' GROUP BY traffic`,
        ),
        q<{ agent: string; views: string }>(
          `SELECT agent, count(*) AS views ${base} AND traffic = 'ai' AND agent IS NOT NULL GROUP BY agent ORDER BY views DESC LIMIT $4`,
          [n],
        ),
        q<{ path: string; views: string; visitors: string }>(
          `SELECT path, count(*) AS views, count(DISTINCT visitor) AS visitors ${base} AND kind = 'pageview' AND traffic = 'human' GROUP BY path ORDER BY views DESC, path LIMIT $4`,
          [n],
        ),
        q<{ query: string; searches: string }>(
          `SELECT lower(query) AS query, count(*) AS searches ${base} AND kind = 'search' AND traffic = 'human' GROUP BY lower(query) ORDER BY searches DESC, query LIMIT $4`,
          [n],
        ),
        q<{ query: string; searches: string }>(
          `SELECT lower(query) AS query, count(*) AS searches ${base} AND kind = 'search' AND results = 0 GROUP BY lower(query) ORDER BY searches DESC, query LIMIT $4`,
          [n],
        ),
        q<{ path: string; up: string; down: string }>(
          `SELECT path, count(*) FILTER (WHERE value = 'up') AS up, count(*) FILTER (WHERE value = 'down') AS down ${base} AND kind = 'feedback' GROUP BY path ORDER BY down DESC, up DESC, path LIMIT $4`,
          [n],
        ),
        q<{ answered: string; unanswered: string }>(
          `SELECT count(*) FILTER (WHERE value = 'answered') AS answered, count(*) FILTER (WHERE value = 'unanswered') AS unanswered ${base} AND kind = 'assistant'`,
        ),
        q<{ host: string; views: string }>(
          `SELECT referrer_host AS host, count(*) AS views ${base} AND kind = 'pageview' AND referrer_host IS NOT NULL AND traffic = 'human' GROUP BY referrer_host ORDER BY views DESC LIMIT $4`,
          [n],
        ),
      ]);
      const unanswered = (await settings(siteId)).logConversations
        ? (
            await db.query<{ topic: string; asked: string }>(
              `SELECT lower(question) AS topic, count(*) AS asked FROM conversations WHERE site_id = $1 AND answered = false AND ts::date BETWEEN $2 AND $3
             GROUP BY lower(question) ORDER BY asked DESC, topic LIMIT $4`,
              [siteId, from, to, n],
            )
          ).rows
        : null;
      const num = (v: string | number) => Number(v);
      return {
        range: { from, to },
        series: series.map((s) => ({
          day: typeof s.day === 'string' ? s.day.slice(0, 10) : day(s.day),
          views: num(s.views),
          visitors: num(s.visitors),
        })),
        traffic: Object.fromEntries(
          traffic.map((t) => [t.traffic, num(t.views)]),
        ) as Record<string, number>,
        aiAgents: agents.map((a) => ({ agent: a.agent, views: num(a.views) })),
        topPages: topPages.map((p) => ({
          path: p.path,
          views: num(p.views),
          visitors: num(p.visitors),
        })),
        topSearches: topSearches.map((s) => ({
          query: s.query,
          searches: num(s.searches),
        })),
        failedSearches: zeroResults.map((s) => ({
          query: s.query,
          searches: num(s.searches),
        })),
        feedback: feedback.map((f) => ({
          path: f.path,
          up: num(f.up),
          down: num(f.down),
        })),
        assistant: {
          answered: num(assistant[0]?.answered ?? 0),
          unanswered: num(assistant[0]?.unanswered ?? 0),
          unansweredTopics:
            unanswered?.map((u) => ({ topic: u.topic, asked: num(u.asked) })) ??
            null,
        },
        referrers: referrers.map((r) => ({
          host: r.host,
          views: num(r.views),
        })),
      };
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
