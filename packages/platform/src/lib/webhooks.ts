import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.ts';
import { systemClock } from './clock.ts';
import type { Db } from './db.ts';
import { type Logger, silentLogger } from './logger.ts';
import type { MetricsRegistry } from './metrics.ts';
import type { Builds } from './builds.ts';
import type { Sites } from './sites.ts';
import type { ProviderId } from './git/types.ts';

const equalSecret = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

/** GitHub: `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`. Compared in constant time. */
export function verifyGitHubSignature(body: Uint8Array, header: string | null, secret: string): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header ?? '');
  if (!m) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(m[1]!, 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** GitLab: `X-Gitlab-Token` carries the secret itself. Compared in constant time. */
export function verifyGitLabToken(header: string | null, secret: string): boolean {
  return header !== null && equalSecret(header, secret);
}

const MAX_BODY = 5 * 1024 * 1024;
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface PushInfo { ref: string; sha: string; repo: string; touched?: string[]; deleted: boolean }

function parsePush(provider: ProviderId, event: string | null, p: Record<string, any>): PushInfo | 'ping' | undefined {
  if (provider === 'github') {
    if (event === 'ping') return 'ping';
    if (event !== 'push' || typeof p['ref'] !== 'string') return undefined;
    const commits = Array.isArray(p['commits']) ? (p['commits'] as Record<string, string[]>[]) : [];
    return {
      ref: p['ref'], sha: String(p['after'] ?? ''), repo: String(p['repository']?.full_name ?? ''), deleted: p['deleted'] === true,
      // GitHub lists at most 20 commits; with more, assume the docs could have changed.
      ...(commits.length > 0 && commits.length < 20 && { touched: commits.flatMap((c) => [...(c['added'] ?? []), ...(c['modified'] ?? []), ...(c['removed'] ?? [])]) }),
    };
  }
  if (event !== 'Push Hook' && p['event_name'] !== 'push') return undefined;
  const commits = Array.isArray(p['commits']) ? (p['commits'] as Record<string, string[]>[]) : [];
  const sha = String(p['checkout_sha'] ?? p['after'] ?? '');
  return {
    ref: String(p['ref'] ?? ''), sha, repo: String(p['project']?.path_with_namespace ?? p['project']?.path ?? ''),
    deleted: /^0+$/.test(String(p['after'] ?? '1')),
    ...(commits.length > 0 && commits.length < 20 && { touched: commits.flatMap((c) => [...(c['added'] ?? []), ...(c['modified'] ?? []), ...(c['removed'] ?? [])]) }),
  };
}

export interface WebhookOptions {
  db: Db;
  sites: Sites;
  builds: Builds;
  clock?: Clock;
  log?: Logger;
  metrics?: MetricsRegistry;
}

/**
 * Receives push events at `/hooks/<provider>/<siteId>`. The site is named in the URL so its secret is known before
 * the body is trusted. The signature is checked first; then the delivery id is recorded and the build queued in one
 * transaction, so a redelivery (GitHub retries, or someone clicks "Redeliver") never builds twice and a crash between
 * the two steps leaves nothing half-done.
 */
export function createWebhookReceiver({ db, sites, builds, clock = systemClock, log = silentLogger, metrics }: WebhookOptions) {
  const received = metrics?.counter('dockudos_webhooks_total', 'Webhook deliveries, by provider and outcome');
  const done = (provider: string, outcome: string, res: Response) => {
    received?.inc({ provider, outcome });
    return res;
  };

  return async function handle(request: Request, provider: ProviderId, siteId: string): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'POST only' });
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY) return done(provider, 'too_large', json(413, { error: 'Payload too large' }));
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BODY) return done(provider, 'too_large', json(413, { error: 'Payload too large' }));

    // Unknown site, wrong provider and wrong signature all answer the same, so ids cannot be probed.
    const unauthorized = () => done(provider, 'unauthorized', json(401, { error: 'Invalid signature' }));
    if (!/^[0-9a-f-]{36}$/i.test(siteId)) return unauthorized();
    const site = await sites.internal(siteId).catch(() => undefined);
    if (!site || site.provider !== provider) return unauthorized();
    const valid = provider === 'github'
      ? verifyGitHubSignature(body, request.headers.get('x-hub-signature-256'), site.webhookSecret)
      : verifyGitLabToken(request.headers.get('x-gitlab-token'), site.webhookSecret);
    if (!valid) {
      log.warn('webhook signature rejected', { provider, site: siteId });
      return unauthorized();
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    } catch {
      return done(provider, 'bad_payload', json(400, { error: 'Body is not JSON' }));
    }
    const event = request.headers.get(provider === 'github' ? 'x-github-event' : 'x-gitlab-event');
    const deliveryId =
      (provider === 'github' ? request.headers.get('x-github-delivery') : request.headers.get('x-gitlab-event-uuid') ?? request.headers.get('idempotency-key')) ||
      `body:${createHash('sha256').update(body).digest('hex')}`;
    if (deliveryId.length > 200) return done(provider, 'bad_payload', json(400, { error: 'Delivery id too long' }));

    const push = parsePush(provider, event, payload);
    if (push === 'ping') return done(provider, 'ping', json(200, { status: 'pong' }));
    const ignore = (reason: string) => done(provider, 'ignored', json(202, { status: 'ignored', reason }));
    if (!push) return ignore(`event "${event ?? ''}" is not a push`);
    if (push.repo.toLowerCase() !== site.repo.toLowerCase()) return ignore('push is for another repository');
    if (push.deleted || !/^[0-9a-f]{7,64}$/i.test(push.sha)) return ignore('branch deleted or no commit');
    if (push.ref !== `refs/heads/${site.defaultBranch}`) return ignore(`only ${site.defaultBranch} is built`);
    if (site.docsDir && push.touched && !push.touched.some((f) => f === site.docsDir || f.startsWith(`${site.docsDir}/`)))
      return ignore('no files in the docs folder changed');

    const result = await db.transaction(async (tx) => {
      const fresh = await tx.query(
        'INSERT INTO webhook_deliveries (provider, delivery_id, site_id, event, received_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [provider, deliveryId, siteId, event ?? '', clock()]);
      if (fresh.rowCount === 0) return 'duplicate' as const;
      return builds.request(site, push.sha, push.ref, 'push', tx);
    });
    if (result === 'duplicate') return done(provider, 'duplicate', json(200, { status: 'duplicate' }));
    log.info('build queued from webhook', { provider, site: siteId, sha: push.sha, build: result.buildId });
    return done(provider, 'queued', json(202, { status: 'queued', buildId: result.buildId }));
  };
}

export type WebhookReceiver = ReturnType<typeof createWebhookReceiver>;
