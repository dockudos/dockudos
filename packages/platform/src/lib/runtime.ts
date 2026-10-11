import { anthropicProvider, type LLMProvider, openaiProvider } from '@dockudos/core';
import { createAgent } from './agent.ts';
import { createAnalytics } from './analytics.ts';
import { createAuth } from './auth.ts';
import { createBuilds, BUILD_QUEUE } from './builds.ts';
import { type Clock, systemClock } from './clock.ts';
import type { PlatformConfig } from './config.ts';
import { createPgDb, type Db } from './db.ts';
import { createEditor } from './editor.ts';
import { createGitHub } from './git/github.ts';
import { createGitLab } from './git/gitlab.ts';
import type { GitProvider, ProviderId } from './git/types.ts';
import { createHealth } from './health.ts';
import { createHttp } from './http.ts';
import { createLogger, type Logger } from './logger.ts';
import { MetricsRegistry } from './metrics.ts';
import { migrate } from './migrations.ts';
import { createOidcLogin } from './oidc-login.ts';
import { createQueue, createWorker } from './queue.ts';
import { createSafeFetch } from './safe-fetch.ts';
import { createSites } from './sites.ts';
import { createFsStorage, createS3Storage, type ObjectStorage } from './storage.ts';
import { createWebhookReceiver } from './webhooks.ts';
import { AGENT_QUEUE } from './agent.ts';

export interface PlatformOverrides {
  db?: Db;
  storage?: ObjectStorage;
  providers?: Partial<Record<ProviderId, GitProvider>>;
  llm?: LLMProvider;
  fetch?: typeof fetch;
  log?: Logger;
  clock?: Clock;
  /** Replace how builds run commands and fetch sources (tests, or a sandboxed runner). */
  run?: import('./exec.ts').CommandRunner;
  source?: import('./sources.ts').SourceFetcher;
}

/**
 * Wire every service from one configuration. Which parts run is decided by `config.services`: a process with only
 * `hooks` still builds the whole object graph (it is cheap), but starts and answers only its own roles.
 */
export async function createPlatform(config: PlatformConfig, o: PlatformOverrides = {}) {
  const clock = o.clock ?? systemClock;
  const log = o.log ?? createLogger({ level: config.logLevel, secrets: config.secrets });
  const metrics = new MetricsRegistry();
  const db = o.db ?? createPgDb(config.databaseUrl, { max: Math.max(5, config.workerConcurrency * 3) });
  const storage = o.storage ?? (config.s3
    ? createS3Storage({ ...config.s3, ...(o.fetch && { fetch: o.fetch }) })
    : createFsStorage(`${config.dataDir}/objects`));

  // Calls to Git hosts, and anything else fetched on behalf of a user, go through the SSRF guard. The configured hosts are trusted.
  const hostOf = (u: string) => new URL(u).hostname.toLowerCase();
  const safe = createSafeFetch({
    allowHosts: [hostOf(config.github.apiUrl), hostOf(config.gitlab.apiUrl), ...config.fetchAllowHosts],
    allowPrivate: config.fetchAllowPrivate,
    ...(o.fetch && { fetch: o.fetch }),
  });
  const providers: Partial<Record<ProviderId, GitProvider>> = o.providers ?? {
    github: createGitHub({ ...(config.github.token && { token: config.github.token }), apiUrl: config.github.apiUrl, fetch: safe }),
    gitlab: createGitLab({ ...(config.gitlab.token && { token: config.gitlab.token }), apiUrl: config.gitlab.apiUrl, fetch: safe }),
  };

  const llm: LLMProvider | undefined = o.llm ?? (config.llm
    ? (config.llm.provider === 'anthropic' ? anthropicProvider : openaiProvider)({
        apiKey: config.llm.apiKey, model: config.llm.model, ...(config.llm.baseUrl && { baseUrl: config.llm.baseUrl }), ...(o.fetch && { fetch: o.fetch as never }),
      })
    : undefined);

  const auth = createAuth({ db, secret: config.sessionSecret, clock, ...(config.adminEmail && { adminEmail: config.adminEmail }) });
  const queue = createQueue({ db, clock });
  const sites = createSites({ db, auth, providers, clock });
  const publicSiteUrl = (site: { slug: string }) => {
    const u = new URL(config.publicUrl);
    return config.sitesDomain ? `${u.protocol}//${site.slug}.${config.sitesDomain}${u.port ? `:${u.port}` : ''}` : config.publicUrl;
  };
  const builds = createBuilds({
    db, queue, storage, sites, auth, providers, clock, log, metrics, secrets: config.secrets, siteUrl: publicSiteUrl,
    workRoot: `${config.dataDir}/work`,
    ...(o.run && { run: o.run }), ...(o.source && { source: o.source }),
  });
  const editor = createEditor({ db, auth, sites, providers, storage, clock });
  const analytics = createAnalytics({
    db, sites, auth, secret: config.sessionSecret, clock,
    defaults: { logConversations: config.analytics.logConversations, retentionDays: config.analytics.retentionDays, conversationRetentionDays: config.analytics.conversationRetentionDays },
  });
  const agent = createAgent({ db, sites, builds, queue, providers, ...(llm && { llm }), clock, log, metrics });
  const webhooks = createWebhookReceiver({ db, sites, builds, clock, log, metrics });
  const oidc = config.oidc
    ? createOidcLogin({
        auth, publicUrl: config.publicUrl, secret: config.sessionSecret, oidc: config.oidc, clock, log,
        ...(o.fetch && { fetch: o.fetch }),
        ...(config.docsAuthSecret && { docsSession: { secret: config.docsAuthSecret, ...(config.cookieDomain && { domain: config.cookieDomain }) } }),
      })
    : undefined;

  const health = createHealth({
    database: async () => void (await db.query('SELECT 1')),
    storage: () => storage.ping(),
  });
  const services = new Set(config.services);
  const handler = createHttp({ config, log, metrics, health, auth, sites, builds, editor, analytics, agent, webhooks, services, ...(oidc && { oidc }) });

  // Workers: one pool takes whichever queues this process has a role for.
  const handlers: Record<string, (typeof builds)['handle']> = {};
  if (services.has('worker')) handlers[BUILD_QUEUE] = builds.handle;
  if (services.has('agent')) handlers[AGENT_QUEUE] = agent.handle;
  const worker = Object.keys(handlers).length ? createWorker({ queue, handlers, concurrency: config.workerConcurrency, log, metrics }) : undefined;

  let timers: ReturnType<typeof setInterval>[] = [];
  const queueGauge = metrics.gauge('dockudos_jobs', 'Jobs by status');

  return {
    config, log, metrics, db, storage, providers, auth, queue, sites, builds, editor, analytics, agent, webhooks, health, handler,

    /** Apply migrations. Safe to run from every process at once. */
    migrate: () => migrate(db, { clock }),

    /** Start the background work this process has roles for. */
    start() {
      worker?.start();
      const every = (ms: number, fn: () => Promise<unknown>, name: string) => {
        const t = setInterval(() => void fn().catch((error) => log.error(`${name} failed`, { error })), ms);
        t.unref();
        timers.push(t);
      };
      if (services.has('worker') || services.has('web')) every(30_000, async () => {
        for (const [status, n] of Object.entries(await queue.stats())) queueGauge.set(n, { status });
      }, 'queue stats');
      if (services.has('agent')) every(5 * 60_000, () => agent.tick(), 'agent tick');
      if (services.has('analytics') || services.has('web')) every(6 * 3600_000, async () => {
        const r = await analytics.purge();
        if (r.events || r.conversations) log.info('analytics purged', r);
      }, 'analytics purge');
      log.info('platform started', { services: config.services });
    },

    async stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
      await worker?.stop();
      if (!o.db) await db.close();
    },
  };
}

export type Platform = Awaited<ReturnType<typeof createPlatform>>;
