import { createRateLimiter } from '@dockudos/core';
import type { Actor, Auth } from './auth.ts';
import type { Agent } from './agent.ts';
import type { Analytics, IngestEvent } from './analytics.ts';
import { ANALYTICS_SCRIPT } from './analytics-script.ts';
import type { Builds } from './builds.ts';
import type { PlatformConfig, ServiceName } from './config.ts';
import type { Editor, PageOperation } from './editor.ts';
import { badRequest, forbidden, notFound, PlatformError, tooMany } from './errors.ts';
import type { createHealth } from './health.ts';
import type { Logger } from './logger.ts';
import type { MetricsRegistry } from './metrics.ts';
import type { createOidcLogin } from './oidc-login.ts';
import type { Sites } from './sites.ts';
import type { ProviderId } from './git/types.ts';
import type { WebhookReceiver } from './webhooks.ts';

export interface HttpDeps {
  config: PlatformConfig;
  log: Logger;
  metrics: MetricsRegistry;
  health: ReturnType<typeof createHealth>;
  auth: Auth;
  sites: Sites;
  builds: Builds;
  editor: Editor;
  analytics: Analytics;
  agent: Agent;
  webhooks: WebhookReceiver;
  oidc?: ReturnType<typeof createOidcLogin>;
  services: ReadonlySet<ServiceName>;
}

interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  actor: () => Promise<Actor>;
  body: <T = Record<string, unknown>>(max?: number) => Promise<T>;
}

type Group = 'web' | 'editor' | 'analytics' | 'auth' | 'hooks' | 'agent';
type Handler = (c: Ctx) => Promise<Response> | Response;

const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'cache-control': 'no-store' };
export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers } });
const CORS_OPEN = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

/**
 * The platform's HTTP surface as one `(Request) => Response` function: nothing here depends on Node's server, so the
 * same handler runs behind `node:http`, a Next.js route, or a test. Every route belongs to a group, and a process
 * answers only the groups of its `DOCKUDOS_SERVICES` roles.
 */
export function createHttp(d: HttpDeps) {
  const { config, log, auth } = d;
  const publicOrigin = new URL(config.publicUrl).origin;
  const requests = d.metrics.counter('dockudos_http_requests_total', 'HTTP requests, by route group and status class');
  const limits = {
    ingest: createRateLimiter({ limit: 120, windowMs: 60_000 }),
    hook: createRateLimiter({ limit: 120, windowMs: 60_000 }),
    login: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    api: createRateLimiter({ limit: 600, windowMs: 60_000 }),
    key: createRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5000 }),
  };
  const routes: { method: string; re: RegExp; keys: string[]; group: Group; fn: Handler }[] = [];
  const route = (method: string, pattern: string, group: Group, fn: Handler) => {
    const keys: string[] = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), '([^/]+)'))}/?$`);
    routes.push({ method, re, keys, group, fn });
  };
  const id = (c: Ctx, k: string) => c.params[k]!;

  // --- identity -------------------------------------------------------------------------------------------------
  route('GET', '/api/v1/me', 'auth', async (c) => {
    const actor = await c.actor();
    return json(200, {
      type: actor.type,
      ...(actor.type === 'user' && { user: { id: actor.user.id, email: actor.user.email, name: actor.user.name, instanceOwner: actor.user.instanceRole === 'owner' } }),
      teams: await auth.listTeams(actor),
    });
  });
  route('GET', '/api/v1/principal', 'auth', async (c) => json(200, { principal: await auth.principalFor(await c.actor()) }));
  route('GET', '/auth/login', 'auth', (c) => (d.oidc ? limited(c, limits.login, 'login') ?? d.oidc.login(c.req) : json(404, { error: { code: 'not_configured', message: 'Sign-in is not configured. Set DOCKUDOS_OIDC_ISSUER and DOCKUDOS_OIDC_CLIENT_ID.' } })));
  route('GET', '/auth/callback', 'auth', (c) => (d.oidc ? limited(c, limits.login, 'login') ?? d.oidc.callback(c.req) : json(404, { error: { code: 'not_configured', message: 'Sign-in is not configured.' } })));
  route('POST', '/auth/logout', 'auth', (c) => (d.oidc ? d.oidc.logout(c.req) : json(404, { error: { code: 'not_configured', message: 'Sign-in is not configured.' } })));

  // --- teams, members, keys ---------------------------------------------------------------------------------------
  route('POST', '/api/v1/teams', 'web', async (c) => json(201, { team: await auth.createTeam(await c.actor(), String((await c.body())['name'] ?? '')) }));
  route('GET', '/api/v1/teams/:id/members', 'web', async (c) => json(200, { members: await auth.listMembers(await c.actor(), id(c, 'id')) }));
  route('PUT', '/api/v1/teams/:id/members', 'web', async (c) => {
    const b = await c.body<{ email?: string; role?: string }>();
    await auth.setMember(await c.actor(), id(c, 'id'), String(b.email ?? ''), b.role as never);
    return json(200, { ok: true });
  });
  route('DELETE', '/api/v1/teams/:id/members/:userId', 'web', async (c) => {
    await auth.removeMember(await c.actor(), id(c, 'id'), id(c, 'userId'));
    return json(200, { ok: true });
  });
  route('GET', '/api/v1/teams/:id/keys', 'web', async (c) => json(200, { keys: await auth.listApiKeys(await c.actor(), id(c, 'id')) }));
  route('POST', '/api/v1/teams/:id/keys', 'web', async (c) => {
    const b = await c.body<{ name?: string; role?: string; expiresInDays?: number }>();
    const { key, secret } = await auth.createApiKey(await c.actor(), id(c, 'id'), String(b.name ?? ''), (b.role ?? 'editor') as never, b.expiresInDays);
    return json(201, { key, secret });
  });
  route('DELETE', '/api/v1/teams/:id/keys/:keyId', 'web', async (c) => {
    await auth.revokeApiKey(await c.actor(), id(c, 'id'), id(c, 'keyId'));
    return json(200, { ok: true });
  });

  // --- sites and builds ---------------------------------------------------------------------------------------------
  route('GET', '/api/v1/teams/:id/sites', 'web', async (c) => json(200, { sites: await d.sites.list(await c.actor(), id(c, 'id')) }));
  route('POST', '/api/v1/teams/:id/sites', 'web', async (c) => {
    const b = await c.body<{ name?: string; provider?: ProviderId; repo?: string; defaultBranch?: string; docsDir?: string }>();
    const r = await d.sites.create(await c.actor(), id(c, 'id'), { name: String(b.name ?? ''), provider: b.provider as ProviderId, repo: String(b.repo ?? ''), ...(b.defaultBranch && { defaultBranch: b.defaultBranch }), ...(b.docsDir && { docsDir: b.docsDir }) });
    return json(201, { site: r.site, webhookSecret: r.webhookSecret, webhookUrl: `${config.publicUrl}/hooks/${r.site.provider}/${r.site.id}` });
  });
  route('GET', '/api/v1/sites/:id', 'web', async (c) => {
    const site = await d.sites.get(await c.actor(), id(c, 'id'));
    return json(200, { site, webhookUrl: `${config.publicUrl}/hooks/${site.provider}/${site.id}`, url: siteUrl(site.slug) });
  });
  route('DELETE', '/api/v1/sites/:id', 'web', async (c) => {
    await d.sites.remove(await c.actor(), id(c, 'id'));
    return json(200, { ok: true });
  });
  route('POST', '/api/v1/sites/:id/webhook-secret', 'web', async (c) => json(200, { webhookSecret: await d.sites.rotateWebhookSecret(await c.actor(), id(c, 'id')) }));
  route('GET', '/api/v1/sites/:id/builds', 'web', async (c) => json(200, { builds: await d.builds.list(await c.actor(), id(c, 'id')) }));
  route('POST', '/api/v1/sites/:id/builds', 'web', async (c) => json(202, await d.builds.rebuild(await c.actor(), id(c, 'id'))));
  route('GET', '/api/v1/builds/:id', 'web', async (c) => json(200, { build: await d.builds.get(await c.actor(), id(c, 'id')) }));

  // --- editor ---------------------------------------------------------------------------------------------------------
  route('GET', '/api/v1/sites/:id/files', 'editor', async (c) => json(200, await d.editor.tree(await c.actor(), id(c, 'id'))));
  route('GET', '/api/v1/sites/:id/file', 'editor', async (c) => json(200, await d.editor.read(await c.actor(), id(c, 'id'), c.url.searchParams.get('path') ?? '', c.url.searchParams.get('ref') ?? undefined)));
  route('POST', '/api/v1/sites/:id/save', 'editor', async (c) => json(200, await d.editor.save(await c.actor(), id(c, 'id'), await c.body(3 * 1024 * 1024))));
  route('POST', '/api/v1/sites/:id/pages', 'editor', async (c) => json(200, await d.editor.planPage(await c.actor(), id(c, 'id'), (await c.body()) as unknown as PageOperation)));
  route('POST', '/api/v1/sites/:id/validate-config', 'editor', async (c) => json(200, await d.editor.validateConfig(await c.actor(), id(c, 'id'), String((await c.body())['json'] ?? ''))));
  route('POST', '/api/v1/sites/:id/media', 'editor', async (c) => {
    const actor = await c.actor();
    const bytes = new Uint8Array(await readBytes(c.req, 11 * 1024 * 1024));
    return json(201, await d.editor.uploadMedia(actor, id(c, 'id'), c.url.searchParams.get('filename') ?? 'file', bytes));
  });

  // --- analytics ------------------------------------------------------------------------------------------------------
  route('GET', '/analytics.js', 'analytics', () => new Response(ANALYTICS_SCRIPT, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin' },
  }));
  route('OPTIONS', '/api/v1/ingest/:siteId', 'analytics', () => new Response(null, { status: 204, headers: CORS_OPEN }));
  route('POST', '/api/v1/ingest/:siteId', 'analytics', async (c) => {
    const slow = limited(c, limits.ingest, `${id(c, 'siteId')}:${c.ip}`);
    if (slow) return slow;
    let event: IngestEvent;
    let raw: Uint8Array;
    try {
      raw = await readBytes(c.req, 8 * 1024);
    } catch (e) {
      if (e instanceof PlatformError) return json(e.status, { error: { code: e.code, message: e.message } }, CORS_OPEN);
      throw e;
    }
    try {
      // Beacons arrive as text/plain, so the content type is not trusted to say it is JSON.
      event = JSON.parse(new TextDecoder().decode(raw)) as IngestEvent;
    } catch {
      return json(400, { error: { code: 'bad_request', message: 'The body must be a JSON event.' } }, CORS_OPEN);
    }
    if (typeof event !== 'object' || event === null) return json(400, { error: { code: 'bad_request', message: 'The body must be a JSON event.' } }, CORS_OPEN);
    // A site's own server may mark AI traffic; a browser must not be able to claim it.
    delete (event as { traffic?: string }).traffic;
    try {
      const r = await d.analytics.ingest(id(c, 'siteId'), event, {
        ip: c.ip, userAgent: c.req.headers.get('user-agent') ?? '', doNotTrack: c.req.headers.get('dnt') === '1' || c.req.headers.get('sec-gpc') === '1',
      });
      return json(202, r, CORS_OPEN);
    } catch (e) {
      // An id that names no site is answered like a recorded event: ids are not for probing.
      if (e instanceof Error && /foreign key|violates/i.test(e.message)) return json(202, { status: 'recorded' }, CORS_OPEN);
      if (e instanceof PlatformError) return json(e.status, { error: { code: e.code, message: e.message } }, CORS_OPEN);
      throw e;
    }
  });
  route('GET', '/api/v1/sites/:id/analytics', 'analytics', async (c) => {
    const q = c.url.searchParams;
    return json(200, await d.analytics.dashboard(await c.actor(), id(c, 'id'), { ...(q.get('from') && { from: q.get('from')! }), ...(q.get('to') && { to: q.get('to')! }) }, Number(q.get('limit') ?? 10)));
  });
  route('GET', '/api/v1/sites/:id/analytics/settings', 'analytics', async (c) => {
    const site = await d.sites.get(await c.actor(), id(c, 'id'), 'site.read');
    return json(200, await d.analytics.settings(site.id));
  });
  route('PUT', '/api/v1/sites/:id/analytics/settings', 'analytics', async (c) => {
    await d.analytics.updateSettings(await c.actor(), id(c, 'id'), await c.body());
    return json(200, { ok: true });
  });

  // --- agent ----------------------------------------------------------------------------------------------------------
  route('GET', '/api/v1/sites/:id/agent', 'agent', async (c) => {
    const site = await d.sites.get(await c.actor(), id(c, 'id'), 'site.read');
    return json(200, { ...(await d.agent.settings(site.id)), modelConfigured: !!config.llm });
  });
  route('PUT', '/api/v1/sites/:id/agent', 'agent', async (c) => {
    await d.agent.configure(await c.actor(), id(c, 'id'), await c.body());
    return json(200, { ok: true });
  });
  route('PUT', '/api/v1/sites/:id/agent/automations/:kind', 'agent', async (c) => {
    await d.agent.setAutomation(await c.actor(), id(c, 'id'), id(c, 'kind') as never, (await c.body()) as never);
    return json(200, { ok: true });
  });
  route('POST', '/api/v1/sites/:id/agent/trigger', 'agent', async (c) => json(202, await d.agent.trigger(await c.actor(), id(c, 'id'), String((await c.body())['kind'] ?? 'watch') as never)));
  route('GET', '/api/v1/sites/:id/agent/runs', 'agent', async (c) => json(200, { runs: await d.agent.listRuns(await c.actor(), id(c, 'id')) }));

  function siteUrl(slug: string): string | undefined {
    if (!config.sitesDomain) return undefined;
    const u = new URL(config.publicUrl);
    return `${u.protocol}//${slug}.${config.sitesDomain}${u.port && !/^(80|443)$/.test(u.port) ? `:${u.port}` : ''}`;
  }

  function limited(c: Ctx, limiter: ReturnType<typeof createRateLimiter>, key: string): Response | undefined {
    const r = limiter.take(key);
    return r.allowed ? undefined : json(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'retry-after': String(r.retryAfter), ...(c.req.method === 'POST' && c.url.pathname.startsWith('/api/v1/ingest') ? CORS_OPEN : {}) });
  }

  function clientIp(req: Request, socketIp: string | undefined): string {
    if (config.trustProxy) {
      const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (xff) return xff;
      const real = req.headers.get('x-real-ip')?.trim();
      if (real) return real;
    }
    return socketIp ?? '';
  }

  async function readBytes(req: Request, max: number): Promise<Uint8Array> {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > max) throw new PlatformError(413, 'too_large', `The body is larger than ${Math.round(max / 1024)} KB.`);
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new PlatformError(413, 'too_large', `The body is larger than ${Math.round(max / 1024)} KB.`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  // `web` is the whole API in one process (the default); the narrower roles let a deployment split it.
  const ROLES: Record<Group, ServiceName[]> = { web: ['web'], editor: ['editor', 'web'], analytics: ['analytics', 'web'], auth: ['auth', 'web'], hooks: ['hooks'], agent: ['agent', 'web'] };
  const enabled = (g: Group) => ROLES[g].some((r) => d.services.has(r));

  /** Handle a request. `info.ip` is the socket's remote address, used when `DOCKUDOS_TRUST_PROXY` is off. */
  return async function handle(req: Request, info: { ip?: string } = {}): Promise<Response> {
    const url = new URL(req.url);
    const start = Date.now();
    let group = 'other';
    const finish = (res: Response) => {
      requests.inc({ group, status: `${Math.floor(res.status / 100)}xx` });
      if (res.status >= 500) log.error('request failed', { method: req.method, path: url.pathname, status: res.status });
      return res;
    };
    try {
      // Hosted documentation: only on its own host, never on the platform's.
      const host = (req.headers.get('host') ?? url.host).toLowerCase().replace(/:\d+$/, '');
      if (config.sitesDomain && d.services.has('site') && host.endsWith(`.${config.sitesDomain}`) && host !== new URL(config.publicUrl).hostname) {
        group = 'site';
        const slug = host.slice(0, -config.sitesDomain.length - 1);
        if (!/^[a-z0-9-]{1,48}$/.test(slug)) return finish(new Response('Not found', { status: 404 }));
        if (req.method !== 'GET' && req.method !== 'HEAD') return finish(new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } }));
        return finish(await d.builds.serve(slug, url.pathname));
      }

      if (url.pathname === '/healthz') return finish(json(200, d.health.live()));
      if (url.pathname === '/readyz') {
        const report = await d.health.ready();
        return finish(json(report.status === 'ok' ? 200 : 503, report));
      }
      if (url.pathname === '/metrics') {
        const given = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
        if (config.metricsToken && given !== config.metricsToken) return finish(json(401, { error: { code: 'unauthorized', message: 'A metrics token is required.' } }));
        return finish(new Response(d.metrics.render(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } }));
      }

      const ip = clientIp(req, info.ip);
      const hook = /^\/hooks\/(github|gitlab)\/([^/]+)\/?$/.exec(url.pathname);
      if (hook) {
        group = 'hooks';
        if (!d.services.has('hooks')) return finish(json(404, { error: { code: 'not_found', message: 'Not found.' } }));
        const slow = limits.hook.take(`${hook[2]}`);
        if (!slow.allowed) return finish(json(429, { error: { code: 'rate_limited', message: 'Too many deliveries.' } }, { 'retry-after': String(slow.retryAfter) }));
        return finish(await d.webhooks(req, hook[1] as ProviderId, hook[2]!));
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        group = r.group;
        if (!enabled(r.group)) return finish(json(404, { error: { code: 'not_found', message: 'Not found.' } }));
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
        let cached: Promise<Actor> | undefined;
        const ctx: Ctx = {
          req, url, params, ip,
          actor: () => (cached ??= (async () => {
            const actor = await auth.requireActor(req);
            // A cookie proves a browser, not a decision: state changes must come from our own pages.
            if (actor.type === 'user' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
              const origin = req.headers.get('origin');
              if (origin !== publicOrigin) throw forbidden('Requests that change data must come from the dashboard.');
            }
            const slow = limits.api.take(actor.type === 'user' ? `u:${actor.user.id}` : `k:${actor.key.id}`);
            if (!slow.allowed) throw tooMany();
            return actor;
          })()),
          body: async <T,>(max = 256 * 1024) => {
            const bytes = await readBytes(req, max);
            if (!bytes.length) return {} as T;
            try {
              const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
              if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
              return v as T;
            } catch {
              throw badRequest('The body must be a JSON object.');
            }
          },
        };
        // Bad bearer tokens are throttled per address so keys cannot be guessed.
        if (req.headers.get('authorization')) {
          const slow = limits.key.take(`auth:${ip}`);
          const attempt = await auth.actorFromRequest(req);
          if (!attempt && !slow.allowed) return finish(json(429, { error: { code: 'rate_limited', message: 'Too many attempts.' } }, { 'retry-after': String(slow.retryAfter) }));
        }
        const res = await r.fn(ctx);
        d.metrics.histogram('dockudos_http_seconds', 'Request time in seconds').observe((Date.now() - start) / 1000, { group });
        return finish(res);
      }
      return finish(json(404, { error: { code: 'not_found', message: notFound().message } }));
    } catch (e) {
      if (e instanceof PlatformError)
        return finish(json(e.status, { error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } }, e.status === 429 ? { 'retry-after': '30' } : {}));
      log.error('unhandled error', { error: e, method: req.method, path: url.pathname });
      return finish(json(500, { error: { code: 'internal', message: 'Something went wrong.' } }));
    }
  };
}

export type PlatformHttp = ReturnType<typeof createHttp>;
