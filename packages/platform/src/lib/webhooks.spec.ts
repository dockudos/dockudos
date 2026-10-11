import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture, type Fixture } from './testing/platform-fixture.ts';
import { verifyGitHubSignature, verifyGitLabToken } from './webhooks.ts';

let db: Db;
let f: Fixture;
beforeAll(async () => {
  db = await createTestDb();
  f = await createFixture(db);
});
afterAll(() => db.close());

const sign = (body: string, secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const SHA = 'a'.repeat(40);
const push = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ref: 'refs/heads/main',
    after: SHA,
    repository: { full_name: f.repo },
    commits: [{ modified: ['index.mdx'] }],
    ...over,
  });
function deliver(
  body: string,
  {
    id = 'd-1',
    secret = f.webhookSecret,
    event = 'push',
    siteId = f.site.id,
    signature,
  }: {
    id?: string;
    secret?: string;
    event?: string;
    siteId?: string;
    signature?: string;
  } = {},
) {
  return f.webhooks(
    new Request('https://platform.test/hooks/github/x', {
      method: 'POST',
      body,
      headers: {
        'x-hub-signature-256': signature ?? sign(body, secret),
        'x-github-event': event,
        'x-github-delivery': id,
      },
    }),
    'github',
    siteId,
  );
}
const jobs = async () =>
  (await db.query("SELECT count(*)::int AS n FROM jobs WHERE queue = 'build'"))
    .rows[0] as { n: number };

describe('signature verification', () => {
  const body = new TextEncoder().encode('{"a":1}');
  it('accepts a valid GitHub signature and rejects every kind of invalid one', () => {
    const good = sign('{"a":1}', 'topsecret');
    expect(verifyGitHubSignature(body, good, 'topsecret')).toBe(true);
    expect(verifyGitHubSignature(body, good, 'other')).toBe(false);
    expect(
      verifyGitHubSignature(
        new TextEncoder().encode('{"a":2}'),
        good,
        'topsecret',
      ),
    ).toBe(false);
    expect(
      verifyGitHubSignature(
        body,
        good.replace('sha256=', 'sha1='),
        'topsecret',
      ),
    ).toBe(false);
    expect(verifyGitHubSignature(body, good.slice(0, -2), 'topsecret')).toBe(
      false,
    );
    expect(verifyGitHubSignature(body, null, 'topsecret')).toBe(false);
    expect(verifyGitHubSignature(body, '', 'topsecret')).toBe(false);
  });
  it('compares GitLab tokens exactly', () => {
    expect(verifyGitLabToken('tok', 'tok')).toBe(true);
    expect(verifyGitLabToken('to', 'tok')).toBe(false);
    expect(verifyGitLabToken('tok2', 'tok')).toBe(false);
    expect(verifyGitLabToken(null, 'tok')).toBe(false);
  });
});

describe('webhook receiver', () => {
  it('rejects bad signatures, unknown sites and wrong providers identically', async () => {
    const body = push();
    const bad = await deliver(body, { secret: 'wrong', id: 'bad-1' });
    const unknown = await deliver(body, {
      siteId: '00000000-0000-0000-0000-000000000000',
      id: 'bad-2',
    });
    const malformed = await deliver(body, {
      siteId: 'not-a-uuid',
      id: 'bad-3',
    });
    const wrongProvider = await f.webhooks(
      new Request('https://p.test/', {
        method: 'POST',
        body,
        headers: { 'x-gitlab-token': f.webhookSecret },
      }),
      'gitlab',
      f.site.id,
    );
    for (const r of [bad, unknown, malformed, wrongProvider]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Invalid signature' });
    }
    expect((await jobs()).n).toBe(0);
  });

  it('answers GET with 405 and ping with pong', async () => {
    expect(
      (
        await f.webhooks(
          new Request('https://p.test/', { method: 'GET' }),
          'github',
          f.site.id,
        )
      ).status,
    ).toBe(405);
    expect(
      await (await deliver('{}', { event: 'ping', id: 'ping-1' })).json(),
    ).toEqual({ status: 'pong' });
  });

  it('queues exactly one build for a push, and a redelivery of the same delivery id does nothing', async () => {
    const first = await deliver(push(), { id: 'dup-1' });
    expect(first.status).toBe(202);
    const { buildId } = (await first.json()) as { buildId: string };
    const again = await deliver(push(), { id: 'dup-1' });
    expect(await again.json()).toEqual({ status: 'duplicate' });
    // A new delivery for the same commit (someone clicked "Redeliver" under a new id) folds into the same build.
    const other = await deliver(push(), { id: 'dup-2' });
    expect(((await other.json()) as { buildId: string }).buildId).toBe(buildId);
    expect((await jobs()).n).toBe(1);
  });

  it.each([
    ['another branch', () => push({ ref: 'refs/heads/feature' }), 'only main'],
    [
      'another repository',
      () => push({ repository: { full_name: 'evil/docs' } }),
      'another repository',
    ],
    ['a deleted branch', () => push({ deleted: true }), 'deleted'],
    ['a bad commit id', () => push({ after: 'zzz' }), 'deleted'],
    ['a push outside the docs folder', null, 'no files'],
  ])('ignores %s', async (_n, body, reason) => {
    if (body === null) {
      const d = await createTestDb();
      const g = await createFixture(d);
      await d.query("UPDATE sites SET docs_dir = 'docs'");
      const inner = push({ repository: { full_name: g.repo } });
      const res = await g.webhooks(
        new Request('https://p.test/', {
          method: 'POST',
          body: inner,
          headers: {
            'x-hub-signature-256': sign(inner, g.webhookSecret),
            'x-github-event': 'push',
            'x-github-delivery': 'o-1',
          },
        }),
        'github',
        g.site.id,
      );
      expect(res.status).toBe(202);
      expect(((await res.json()) as { reason: string }).reason).toContain(
        reason,
      );
      await d.close();
      return;
    }
    const res = await deliver(body(), { id: `ign-${_n}` });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { reason: string }).reason).toContain(reason);
  });

  it('ignores non-push events, rejects non-JSON and oversize bodies', async () => {
    expect(
      (
        (await (
          await deliver(push(), { event: 'issues', id: 'ev-1' })
        ).json()) as { reason: string }
      ).reason,
    ).toContain('not a push');
    expect((await deliver('not json', { id: 'nj-1' })).status).toBe(400);
    const huge = await f.webhooks(
      new Request('https://p.test/', {
        method: 'POST',
        body: '{}',
        headers: { 'content-length': String(6 * 1024 * 1024) },
      }),
      'github',
      f.site.id,
    );
    expect(huge.status).toBe(413);
  });

  it('accepts GitLab push hooks with the token header', async () => {
    const d = await createTestDb();
    const g = await createFixture(d);
    g.gitlab.seed('grp/docs', { 'docs.json': '{}' });
    const { site, webhookSecret } = await g.sites.create(g.actor, g.team.id, {
      name: 'GL Docs',
      provider: 'gitlab',
      repo: 'grp/docs',
    });
    const body = JSON.stringify({
      event_name: 'push',
      ref: 'refs/heads/main',
      after: SHA,
      checkout_sha: SHA,
      project: { path_with_namespace: 'grp/docs' },
      commits: [],
    });
    const send = (token: string, id: string) =>
      g.webhooks(
        new Request('https://p.test/', {
          method: 'POST',
          body,
          headers: {
            'x-gitlab-token': token,
            'x-gitlab-event': 'Push Hook',
            'x-gitlab-event-uuid': id,
          },
        }),
        'gitlab',
        site.id,
      );
    expect((await send('wrong', 'u1')).status).toBe(401);
    expect((await send(webhookSecret, 'u1')).status).toBe(202);
    expect(await (await send(webhookSecret, 'u1')).json()).toEqual({
      status: 'duplicate',
    });
    await d.close();
  });

  it('counts outcomes in metrics', () => {
    const text = f.metrics.render();
    expect(text).toMatch(
      /dockudos_webhooks_total\{outcome="queued",provider="github"\} 2/,
    );
    expect(text).toContain('outcome="unauthorized"');
  });
});
