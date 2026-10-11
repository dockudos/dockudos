import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnalytics } from './analytics.ts';
import type { Db } from './db.ts';
import {
  classifyTraffic,
  cleanPath,
  dailyVisitor,
  referrerHost,
  scrubText,
  truncateIp,
} from './privacy.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture, type Fixture } from './testing/platform-fixture.ts';

describe('privacy transforms', () => {
  it('truncates IPv4 to /24 and IPv6 to /48', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('2001:db8:abcd:1234:5678:9abc:def0:1234')).toBe(
      '2001:db8:abcd::',
    );
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncateIp('fe80::1%eth0')).toBe('fe80:0:0::');
    expect(truncateIp(undefined)).toBe('0.0.0.0');
    expect(truncateIp('garbage')).toBe('0.0.0.0');
  });

  it('makes a one-day visitor hash that neighbours share, other days and sites do not, and that leaks no address', () => {
    const a = dailyVisitor('k', 's1', '203.0.113.5', 'UA', '2026-03-01');
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(dailyVisitor('k', 's1', '203.0.113.200', 'UA', '2026-03-01')).toBe(
      a,
    );
    expect(dailyVisitor('k', 's1', '203.0.113.5', 'UA', '2026-03-02')).not.toBe(
      a,
    );
    expect(dailyVisitor('k', 's2', '203.0.113.5', 'UA', '2026-03-01')).not.toBe(
      a,
    );
    expect(
      dailyVisitor('k', 's1', '198.51.100.5', 'UA', '2026-03-01'),
    ).not.toBe(a);
    expect(
      dailyVisitor('other', 's1', '203.0.113.5', 'UA', '2026-03-01'),
    ).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('classifies people, AI tools and bots', () => {
    expect(
      classifyTraffic('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'),
    ).toEqual({ traffic: 'human' });
    expect(classifyTraffic('Mozilla/5.0 (compatible; GPTBot/1.1)')).toEqual({
      traffic: 'ai',
      agent: 'OpenAI',
    });
    expect(classifyTraffic('ClaudeBot/1.0')).toEqual({
      traffic: 'ai',
      agent: 'Anthropic',
    });
    expect(
      classifyTraffic('Mozilla/5.0 (compatible; PerplexityBot/1.0)').agent,
    ).toBe('Perplexity');
    expect(classifyTraffic('Googlebot/2.1')).toEqual({ traffic: 'bot' });
    expect(classifyTraffic('')).toEqual({ traffic: 'bot' });
    expect(classifyTraffic('curl/8.0')).toEqual({ traffic: 'bot' });
    expect(classifyTraffic('Mozilla/5.0', 'ai')).toEqual({
      traffic: 'ai',
      agent: 'MCP client',
    });
  });

  it('scrubs emails, numbers, ids and token-like strings from typed text', () => {
    expect(scrubText('contact me at Jane.Doe@example.com please')).toBe(
      'contact me at [email] please',
    );
    expect(scrubText('call +1 (555) 123-4567')).toBe('call +[number]');
    expect(scrubText('id 123e4567-e89b-12d3-a456-426614174000')).toBe(
      'id [id]',
    );
    expect(scrubText('key sk-abcdefghijklmnop1234')).toContain('[token]');
    expect(scrubText('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      '[token]',
    );
    expect(scrubText('how do I install   the  CLI?')).toBe(
      'how do I install the CLI?',
    );
    expect(scrubText('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });

  it('keeps only paths and referrer hosts', () => {
    expect(cleanPath('/guide/auth?token=abc#x')).toBe('/guide/auth');
    expect(cleanPath('https://docs.test/guide//auth/?a=1')).toBe('/guide/auth');
    expect(cleanPath('/')).toBe('/');
    expect(cleanPath('guide')).toBeUndefined();
    expect(cleanPath('/a b')).toBeUndefined();
    expect(cleanPath('/' + 'a'.repeat(400))).toBeUndefined();
    expect(cleanPath(undefined)).toBeUndefined();
    expect(cleanPath('http://[bad')).toBeUndefined();
    expect(referrerHost('https://News.Example.com/a/b?q=secret')).toBe(
      'news.example.com',
    );
    expect(referrerHost('not a url')).toBeUndefined();
  });
});

let db: Db;
let f: Fixture;
let a: ReturnType<typeof createAnalytics>;
beforeAll(async () => {
  db = await createTestDb();
  f = await createFixture(db);
  a = createAnalytics({
    db,
    sites: f.sites,
    auth: f.auth,
    secret: 'analytics-secret',
    clock: f.clock,
  });
});
afterAll(() => db.close());

const human = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 Firefox/130' };

describe('ingestion stores no personal data (P5 acceptance)', () => {
  it('records a page view, a zero-result search and feedback, and the rows hold no address or user agent', async () => {
    expect(
      (
        await a.ingest(
          f.site.id,
          {
            kind: 'pageview',
            path: '/guide?utm=1',
            referrer: 'https://news.example.com/post/1?x=y',
          },
          human,
        )
      ).status,
    ).toBe('recorded');
    await a.ingest(
      f.site.id,
      {
        kind: 'search',
        query: 'webhook retries for bob@example.com',
        results: 0,
      },
      human,
    );
    await a.ingest(
      f.site.id,
      { kind: 'feedback', path: '/guide', value: 'down' },
      human,
    );
    const rows = (
      await db.query('SELECT * FROM analytics_events WHERE site_id = $1', [
        f.site.id,
      ])
    ).rows;
    expect(rows.map((r: any) => r.kind).sort()).toEqual([
      'feedback',
      'pageview',
      'search',
    ]);
    const dump = JSON.stringify(rows);
    for (const needle of [
      '203.0.113',
      'Firefox',
      'Mozilla',
      'bob@example.com',
      'utm=1',
      '/post/1',
    ])
      expect(dump).not.toContain(needle);
    expect(rows.find((r: any) => r.kind === 'search')).toMatchObject({
      query: 'webhook retries for [email]',
      results: 0,
    });
    expect(rows.find((r: any) => r.kind === 'pageview')).toMatchObject({
      path: '/guide',
      referrer_host: 'news.example.com',
    });
  });

  it('honours Do Not Track and rejects malformed events', async () => {
    expect(
      await a.ingest(
        f.site.id,
        { kind: 'pageview', path: '/x' },
        { ...human, doNotTrack: true },
      ),
    ).toEqual({ status: 'skipped', reason: 'do-not-track' });
    expect(
      await a.ingest(
        f.site.id,
        { kind: 'search', query: '   ', results: 1 },
        human,
      ),
    ).toEqual({ status: 'skipped', reason: 'empty-query' });
    await expect(
      a.ingest(f.site.id, { kind: 'bogus' as never }, human),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      a.ingest(f.site.id, { kind: 'pageview', path: 'nope' }, human),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      a.ingest(
        f.site.id,
        { kind: 'feedback', path: '/x', value: 'meh' },
        human,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      a.ingest(f.site.id, { kind: 'search', query: 'q', results: -1 }, human),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('does not log conversations unless the site opts in', async () => {
    await a.ingest(
      f.site.id,
      {
        kind: 'assistant',
        query: 'how do I rotate keys?',
        value: 'unanswered',
      },
      human,
    );
    expect(
      (
        await db.query('SELECT 1 FROM conversations WHERE site_id = $1', [
          f.site.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await a.dashboard(f.actor, f.site.id)).assistant).toMatchObject({
      unanswered: 1,
      unansweredTopics: null,
    });
  });
});

describe('conversation logging and retention', () => {
  it('logs scrubbed conversations after opt-in, lists unanswered topics, and forgets them when switched off', async () => {
    await a.updateSettings(f.actor, f.site.id, { logConversations: true });
    await a.ingest(
      f.site.id,
      {
        kind: 'assistant',
        query: 'How do I reset the password for jo@x.com?',
        value: 'unanswered',
        cited: ['/guide?x=1', 'bad'],
      },
      human,
    );
    await a.ingest(
      f.site.id,
      {
        kind: 'assistant',
        query: 'how do i reset the password for jo@x.com?',
        value: 'unanswered',
      },
      human,
    );
    await a.ingest(
      f.site.id,
      {
        kind: 'assistant',
        query: 'What is a site?',
        answer: 'A site is...',
        value: 'answered',
        cited: ['/guide'],
      },
      human,
    );
    const board = await a.dashboard(f.actor, f.site.id);
    expect(board.assistant.unansweredTopics).toEqual([
      { topic: 'how do i reset the password for [email]?', asked: 2 },
    ]);
    expect(
      (await db.query('SELECT cited_paths FROM conversations WHERE answered'))
        .rows[0],
    ).toEqual({ cited_paths: ['/guide'] });
    await a.updateSettings(f.actor, f.site.id, { logConversations: false });
    expect(
      (
        await db.query('SELECT 1 FROM conversations WHERE site_id = $1', [
          f.site.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('purges events and conversations past their retention', async () => {
    const d = await createTestDb();
    const g = await createFixture(d);
    const old = new Date(g.clock().getTime() - 100 * 86_400_000);
    const an = createAnalytics({
      db: d,
      sites: g.sites,
      auth: g.auth,
      secret: 'k',
      clock: () => old,
    });
    await an.updateSettings(g.actor, g.site.id, {
      logConversations: true,
      conversationRetentionDays: 7,
    });
    await an.ingest(g.site.id, { kind: 'pageview', path: '/old' }, human);
    await an.ingest(
      g.site.id,
      { kind: 'assistant', query: 'old question', value: 'answered' },
      human,
    );
    const now = createAnalytics({
      db: d,
      sites: g.sites,
      auth: g.auth,
      secret: 'k',
      clock: g.clock,
    });
    await now.ingest(g.site.id, { kind: 'pageview', path: '/new' }, human);
    expect(await now.purge()).toEqual({ events: 2, conversations: 1 });
    expect(
      (
        await d.query('SELECT path FROM analytics_events WHERE kind = $1', [
          'pageview',
        ])
      ).rows,
    ).toEqual([{ path: '/new' }]);
    await expect(
      now.updateSettings(g.actor, g.site.id, { eventRetentionDays: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    await d.close();
  });
});

describe('dashboards (P5.14)', () => {
  it('summarises seeded data: top pages, failed searches, feedback, assistant, traffic split', async () => {
    const d = await createTestDb();
    const g = await createFixture(d);
    const an = createAnalytics({
      db: d,
      sites: g.sites,
      auth: g.auth,
      secret: 'k',
      clock: g.clock,
    });
    const ctx = (ip: string) => ({ ip, userAgent: 'Mozilla/5.0 Firefox' });
    for (const [ip, path] of [
      ['1.1.1.1', '/a'],
      ['1.1.1.1', '/a'],
      ['2.2.2.2', '/a'],
      ['3.3.3.3', '/b'],
    ] as const)
      await an.ingest(g.site.id, { kind: 'pageview', path }, ctx(ip));
    await an.ingest(
      g.site.id,
      { kind: 'pageview', path: '/a' },
      { ip: '9.9.9.9', userAgent: 'GPTBot/1.1' },
    );
    await an.ingest(
      g.site.id,
      { kind: 'pageview', path: '/a' },
      { ip: '8.8.8.8', userAgent: 'Googlebot' },
    );
    await an.ingest(
      g.site.id,
      { kind: 'search', query: 'Webhooks', results: 0 },
      ctx('1.1.1.1'),
    );
    await an.ingest(
      g.site.id,
      { kind: 'search', query: 'webhooks', results: 0 },
      ctx('2.2.2.2'),
    );
    await an.ingest(
      g.site.id,
      { kind: 'search', query: 'install', results: 4 },
      ctx('2.2.2.2'),
    );
    await an.ingest(
      g.site.id,
      { kind: 'feedback', path: '/a', value: 'down' },
      ctx('1.1.1.1'),
    );
    await an.ingest(
      g.site.id,
      { kind: 'feedback', path: '/a', value: 'up' },
      ctx('2.2.2.2'),
    );
    await an.ingest(
      g.site.id,
      { kind: 'assistant', query: 'q', value: 'answered' },
      ctx('1.1.1.1'),
    );
    const board = await an.dashboard(g.actor, g.site.id);
    expect(board.topPages).toEqual([
      { path: '/a', views: 3, visitors: 2 },
      { path: '/b', views: 1, visitors: 1 },
    ]);
    expect(board.series).toEqual([
      { day: '2026-03-01', views: 4, visitors: 3 },
    ]);
    expect(board.failedSearches).toEqual([{ query: 'webhooks', searches: 2 }]);
    expect(board.topSearches[0]).toEqual({ query: 'webhooks', searches: 2 });
    expect(board.feedback).toEqual([{ path: '/a', up: 1, down: 1 }]);
    expect(board.traffic).toEqual({ human: 4, ai: 1, bot: 1 });
    expect(board.aiAgents).toEqual([{ agent: 'OpenAI', views: 1 }]);
    expect(board.assistant).toMatchObject({ answered: 1, unanswered: 0 });
    expect(board.range).toEqual({ from: '2026-01-31', to: '2026-03-01' });
    expect(
      (
        await an.dashboard(g.actor, g.site.id, {
          from: '2026-03-02',
          to: '2026-03-03',
        })
      ).topPages,
    ).toEqual([]);
    await d.close();
  });

  it('checks access and the date range', async () => {
    const stranger = await f.auth.upsertUser({
      sub: `an-${Math.random()}`,
      email: `an${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    await expect(
      a.dashboard({ type: 'user', user: stranger }, f.site.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      a.updateSettings({ type: 'user', user: stranger }, f.site.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      a.dashboard(f.actor, f.site.id, { from: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      a.dashboard(f.actor, f.site.id, { from: '2026-03-02', to: '2026-03-01' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      a.dashboard(f.actor, f.site.id, { from: '2020-01-01', to: '2026-03-01' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
