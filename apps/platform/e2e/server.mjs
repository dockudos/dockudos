// A real platform for the browser tests: the same code that runs in production, with an in-process Postgres (PGlite),
// an in-memory Git host and in-memory storage. It also has a few `/__e2e/*` helpers that production does not have.
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  apiSource,
  createMemoryGit,
  createMemoryStorage,
  createPlatform,
  loadConfig,
  migrate,
} from '@dockudos/platform';

const API_PORT = 4500;
const UI_ORIGIN = 'http://localhost:4501';

const lite = await PGlite.create();
const wrap = (q) => ({
  async query(sql, params) {
    const r = await q.query(sql, params);
    return { rows: r.rows, rowCount: r.rows.length || (r.affectedRows ?? 0) };
  },
  async exec(sql) {
    await q.exec(sql);
  },
});
const db = {
  ...wrap(lite),
  transaction: (fn) => lite.transaction((tx) => fn(wrap(tx))),
  close: () => lite.close(),
};

const git = createMemoryGit('github');
const platform = await createPlatform(
  loadConfig({
    DOCKUDOS_DATABASE_URL: 'postgres://unused@localhost/unused',
    DOCKUDOS_PUBLIC_URL: UI_ORIGIN,
    DOCKUDOS_SESSION_SECRET: 'e2e-session-secret-0123456789abcdef-xyz',
    DOCKUDOS_DATA_DIR: join(tmpdir(), 'dkd-e2e'),
    DOCKUDOS_SITES_DOMAIN: 'sites.localhost',
    DOCKUDOS_LOG_LEVEL: 'warn',
  }),
  {
    db,
    storage: createMemoryStorage(),
    providers: { github: git },
    source: apiSource,
    run: async ({ args, cwd }) => {
      if (args.includes('build')) {
        await mkdir(join(cwd, 'out'), { recursive: true });
        await writeFile(
          join(cwd, 'out/index.html'),
          `<h1>Built ${Date.now()}</h1>`,
        );
      }
      return { code: 0 };
    },
  },
);
await migrate(db);

// Seed: a team with a site, a built copy, and a month of readers.
const owner = await platform.auth.upsertUser({
  sub: 'e2e-owner',
  email: 'owner@acme.test',
  name: 'Olivia Owner',
  roles: [],
  groups: [],
});
const actor = { type: 'user', user: owner };
const team = await platform.auth.createTeam(actor, 'Acme');
const seed = () =>
  git.seed('acme/docs', {
    'docs.json': JSON.stringify(
      {
        name: 'Acme Docs',
        theme: { primary: '#2563eb' },
        navigation: [
          {
            tab: 'Docs',
            groups: [{ group: 'Start', pages: ['index', 'guides/webhooks'] }],
          },
        ],
      },
      null,
      2,
    ),
    'docs/index.mdx':
      '---\ntitle: Welcome\n---\n\n# Welcome\n\nHello from Acme.\n',
    'docs/guides/webhooks.mdx':
      '---\ntitle: Webhooks\n---\n\n## Verify deliveries\n\nCheck the signature.\n',
  });
seed();
const { site, webhookSecret } = await platform.sites.create(actor, team.id, {
  name: 'Acme Docs',
  provider: 'github',
  repo: 'acme/docs',
});
await platform.builds.rebuild(actor, site.id);
const ctx = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 Firefox/130' };
for (const [path, n] of [
  ['/guides/webhooks', 5],
  ['/', 3],
  ['/quickstart', 2],
])
  for (let i = 0; i < n; i++)
    await platform.analytics.ingest(
      site.id,
      { kind: 'pageview', path },
      { ip: `198.51.100.${i + 1}`, userAgent: 'Mozilla/5.0 Firefox/130' },
    );
await platform.analytics.ingest(
  site.id,
  { kind: 'pageview', path: '/guides/webhooks' },
  { ip: '192.0.2.1', userAgent: 'GPTBot/1.1' },
);
await platform.analytics.ingest(
  site.id,
  { kind: 'search', query: 'webhook retries', results: 0 },
  ctx,
);
await platform.analytics.ingest(
  site.id,
  { kind: 'search', query: 'install', results: 6 },
  ctx,
);
await platform.analytics.ingest(
  site.id,
  { kind: 'feedback', path: '/guides/webhooks', value: 'down' },
  ctx,
);
await platform.analytics.ingest(
  site.id,
  { kind: 'assistant', query: 'how do I rotate keys', value: 'unanswered' },
  ctx,
);
platform.start();

const state = () => ({
  siteId: site.id,
  teamId: team.id,
  webhookSecret,
  pulls: git.pulls,
  pushes: git.pushes,
  main: git.snapshot('acme/docs', 'main'),
  head: git.branches('acme/docs').main,
});

const handler = async (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/__e2e/login') {
    const token = await platform.auth.sessionToken(owner);
    return new Response(null, {
      status: 302,
      headers: {
        location: url.searchParams.get('returnTo') ?? '/',
        'set-cookie': `dockudos_platform=${token}; Path=/; HttpOnly; SameSite=Lax`,
      },
    });
  }
  if (url.pathname === '/__e2e/state') return Response.json(state());
  if (url.pathname === '/__e2e/reset') {
    git.pulls.length = 0;
    git.pushes.length = 0;
    return Response.json({ ok: true });
  }
  if (url.pathname === '/__e2e/push') {
    const files = await req.json();
    git.push('acme/docs', 'main', files);
    return Response.json({ head: git.branches('acme/docs').main });
  }
  if (url.pathname === '/__e2e/webhook') {
    const sha = git.push('acme/docs', 'main', {
      'docs/index.mdx': `---\ntitle: Welcome\n---\n\n# Welcome\n\nUpdated by a push ${Date.now()}\n`,
    });
    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      after: sha,
      repository: { full_name: 'acme/docs' },
      commits: [{ modified: ['docs/index.mdx'] }],
    });
    const res = await platform.handler(
      new Request(`${UI_ORIGIN}/hooks/github/${site.id}`, {
        method: 'POST',
        body: payload,
        headers: {
          'x-hub-signature-256': `sha256=${createHmac('sha256', webhookSecret).update(payload).digest('hex')}`,
          'x-github-event': 'push',
          'x-github-delivery': `e2e-${Date.now()}`,
        },
      }),
    );
    return Response.json({ status: res.status, sha });
  }
  return platform.handler(req, { ip: '127.0.0.1' });
};

createServer(async (incoming, outgoing) => {
  const url = new URL(
    incoming.url ?? '/',
    `http://${incoming.headers.host ?? 'localhost'}`,
  );
  const headers = new Headers();
  for (const [k, v] of Object.entries(incoming.headers))
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const method = incoming.method ?? 'GET';
  const request = new Request(url, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: Readable.toWeb(incoming), duplex: 'half' }),
  });
  const res = await handler(request);
  const out = {};
  res.headers.forEach((v, k) => {
    if (k !== 'set-cookie') out[k] = v;
  });
  if (res.headers.getSetCookie().length)
    out['set-cookie'] = res.headers.getSetCookie();
  outgoing.writeHead(res.status, out);
  if (!res.body) return outgoing.end();
  Readable.fromWeb(res.body).pipe(outgoing);
}).listen(API_PORT, '127.0.0.1', () =>
  console.log(`e2e platform on ${API_PORT}`),
);
