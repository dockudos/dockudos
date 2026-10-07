import type { AccessRule } from '@dockudos/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, authorizePage, createAccessProxy } from './access.ts';
import { createKudosHandler } from './kudos.ts';
import { createMarkdownHandler } from './markdown.ts';
import { getSite, pageMetadata, sitemapResponse } from './server.ts';

const basic = (user: string, password: string) =>
  `Basic ${btoa(`${user}:${password}`)}`;
const req = (
  path: string,
  headers: Record<string, string> = {},
  init: RequestInit = {},
) =>
  new Request(`http://docs.test${path}`, {
    headers: { host: 'docs.test', ...headers },
    ...init,
  });
const rule = (
  over: Partial<AccessRule> & Pick<AccessRule, 'paths' | 'require'>,
): AccessRule => over;
const env = {
  DOCKUDOS_BASIC_AUTH: 'ada:lovelace,bob:builder',
  DOCKUDOS_TOKEN: 'secret-token-123',
  TEAM_PW: 'team:pw',
};

describe('authorize', () => {
  it('basic: lets matching credentials through and challenges everything else', async () => {
    const r = rule({ paths: ['/x'], require: 'basic', realm: 'Team "docs"' });
    expect(
      await authorize(
        req('/x', { authorization: basic('bob', 'builder') }),
        r,
        { env },
      ),
    ).toBeUndefined();

    const attempts: Record<string, string>[] = [
      {},
      { authorization: basic('ada', 'wrong') },
      { authorization: 'Bearer secret-token-123' },
    ];
    for (const headers of attempts) {
      const res = (await authorize(req('/x', headers), r, { env }))!;
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        'Basic realm="Team docs", charset="UTF-8"',
      );
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('basic: reads the variable the rule names', async () => {
    const r = rule({ paths: ['/x'], require: 'basic', secretEnv: 'TEAM_PW' });
    expect(
      await authorize(req('/x', { authorization: basic('team', 'pw') }), r, {
        env,
      }),
    ).toBeUndefined();
    expect(
      (await authorize(
        req('/x', { authorization: basic('ada', 'lovelace') }),
        r,
        { env },
      ))!.status,
    ).toBe(401);
  });

  it('token: accepts a bearer token or the x-docs-token header', async () => {
    const r = rule({ paths: ['/x'], require: 'token' });
    expect(
      await authorize(
        req('/x', { authorization: 'Bearer secret-token-123' }),
        r,
        { env },
      ),
    ).toBeUndefined();
    expect(
      await authorize(req('/x', { 'x-docs-token': 'secret-token-123' }), r, {
        env,
      }),
    ).toBeUndefined();
    const res = (await authorize(
      req('/x', { authorization: 'Bearer nope-nope-nope' }),
      r,
      { env },
    ))!;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('deny: answers 404 whatever is sent', async () => {
    const res = (await authorize(
      req('/x', { authorization: basic('ada', 'lovelace') }),
      rule({ paths: ['/x'], require: 'deny' }),
      { env },
    ))!;
    expect(res.status).toBe(404);
  });

  it('custom: the verify function decides, and may answer with its own response', async () => {
    const r = rule({ paths: ['/x'], require: 'custom' });
    expect(
      await authorize(req('/x'), r, { verify: () => true }),
    ).toBeUndefined();
    expect(
      (await authorize(req('/x'), r, { verify: async () => false }))!.status,
    ).toBe(403);
    const redirect = Response.redirect('http://docs.test/login', 302);
    expect(await authorize(req('/x'), r, { verify: () => redirect })).toBe(
      redirect,
    );
  });

  it.each([
    ['basic', {}, undefined],
    ['basic', { DOCKUDOS_BASIC_AUTH: 'malformed' }, undefined],
    ['token', {}, undefined],
    ['token', { DOCKUDOS_TOKEN: 'short' }, undefined],
    ['custom', env, undefined],
  ] as const)(
    'fails closed with 503 when a %s rule has nothing to check against',
    async (kind, vars, verify) => {
      const spy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const res = (await authorize(
        req('/x', { authorization: basic('a', 'b') }),
        rule({ paths: ['/x'], require: kind }),
        { env: vars, verify },
      ))!;
      expect(res.status).toBe(503);
      expect(await res.text()).not.toMatch(/DOCKUDOS|env/i);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('/x'));
      spy.mockRestore();
    },
  );
});

describe('createAccessProxy', () => {
  const rules = [
    rule({ paths: ['/private/**', '/print'], require: 'basic' }),
    rule({ paths: ['/api/**'], require: 'token' }),
  ];
  const proxy = createAccessProxy({ rules, env });
  const good = { authorization: basic('ada', 'lovelace') };

  it('lets open paths straight through', async () => {
    expect(await proxy(req('/guides/a'))).toBeUndefined();
    expect(await proxy(req('/'))).toBeUndefined();
  });

  it('protects every route a rule names, including /print and API routes', async () => {
    for (const path of [
      '/print',
      '/private',
      '/private/a/b',
      '/private/a?x=1',
      '/private//a/',
      '/%70rivate/a',
    ]) {
      expect((await proxy(req(path)))!.status, path).toBe(401);
    }
    expect((await proxy(req('/api/markdown')))!.status).toBe(401);
    expect(
      (await proxy(
        req('/api/markdown', { authorization: 'Bearer secret-token-123' }),
      ))!.status,
    ).toBe(200);
  });

  it('a rule for one way does not accept the other', async () => {
    expect(
      (await proxy(
        req('/private/a', { authorization: 'Bearer secret-token-123' }),
      ))!.status,
    ).toBe(401);
    expect((await proxy(req('/api/x', good)))!.status).toBe(401);
  });

  it('marks what it lets through as private and not for search engines', async () => {
    const res = (await proxy(req('/private/a', good)))!;
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('with no rules it does nothing', async () => {
    expect(
      await createAccessProxy({ rules: [] })(req('/private/a')),
    ).toBeUndefined();
  });

  it('reads the rules the build carried in DOCKUDOS_ACCESS', async () => {
    vi.stubEnv(
      'DOCKUDOS_ACCESS',
      JSON.stringify([rule({ paths: ['/only'], require: 'deny' })]),
    );
    try {
      const fromBuild = createAccessProxy({ env });
      expect((await fromBuild(req('/only')))!.status).toBe(404);
      expect(await fromBuild(req('/other'))).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv('DOCKUDOS_ACCESS', '{not json');
    try {
      expect(await createAccessProxy({ env })(req('/only'))).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('authorizePage', () => {
  const rules = [rule({ paths: ['/private/**'], require: 'basic' })];

  it('applies the rule for the page a handler is about to serve', async () => {
    expect(
      (await authorizePage(req('/api/markdown'), '/private/a', { rules, env }))!
        .status,
    ).toBe(401);
    expect(
      await authorizePage(
        req('/api/markdown', { authorization: basic('ada', 'lovelace') }),
        '/private/a',
        { rules, env },
      ),
    ).toBeUndefined();
    expect(
      await authorizePage(req('/api/markdown'), '/public/a', { rules, env }),
    ).toBeUndefined();
  });
});

describe('with a real site', () => {
  let root: string;
  let cwd: string;
  const config = (extra: object) =>
    writeFile(
      join(root, 'docs.json'),
      JSON.stringify({
        name: 'Acme',
        seo: { siteUrl: 'https://docs.acme.dev' },
        ...extra,
      }),
    );

  beforeEach(async () => {
    cwd = process.cwd();
    root = await mkdtemp(join(tmpdir(), 'dockudos-access-'));
    await mkdir(join(root, 'docs', 'private'), { recursive: true });
    await writeFile(join(root, 'docs', 'index.mdx'), '[secret](/private/plan)');
    await writeFile(join(root, 'docs', 'open.mdx'), '# Open');
    await writeFile(
      join(root, 'docs', 'private', 'plan.mdx'),
      '---\ntitle: Plan\n---\nTop secret plan',
    );
    await config({
      access: { rules: [{ paths: ['/private/**'], require: 'basic' }] },
    });
    process.chdir(root);
  });
  afterEach(async () => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const asAda = { authorization: basic('ada', 'lovelace') };

  it('the markdown route needs the page’s credentials, and does not reveal whether a page exists', async () => {
    vi.stubEnv('DOCKUDOS_BASIC_AUTH', 'ada:lovelace');
    vi.stubEnv(
      'DOCKUDOS_ACCESS',
      JSON.stringify([{ paths: ['/private/**'], require: 'basic' }]),
    );
    const GET = createMarkdownHandler();
    const url = (p: string) =>
      `http://docs.test/api/markdown?path=${encodeURIComponent(p)}`;
    expect((await GET(new Request(url('/private/plan')))).status).toBe(401);
    expect((await GET(new Request(url('/private/nope')))).status).toBe(401); // same answer: no oracle
    const ok = await GET(new Request(url('/private/plan'), { headers: asAda }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Top secret plan');
    expect((await GET(new Request(url('/open')))).status).toBe(200);
  });

  it('the kudos route refuses votes on a protected page without credentials, and answers alike for unknown ones', async () => {
    vi.stubEnv('DOCKUDOS_BASIC_AUTH', 'ada:lovelace');
    vi.stubEnv(
      'DOCKUDOS_ACCESS',
      JSON.stringify([{ paths: ['/private/**'], require: 'basic' }]),
    );
    const entries: unknown[] = [];
    const POST = createKudosHandler({
      store: { add: async (e) => void entries.push(e) },
    });
    const post = (path: string, headers = {}) =>
      POST(
        new Request('http://docs.test/api/kudos', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            host: 'docs.test',
            ...headers,
          },
          body: JSON.stringify({ path, vote: 'up' }),
        }),
      );
    expect((await post('/private/plan')).status).toBe(401);
    expect((await post('/private/nope')).status).toBe(401);
    expect(entries).toEqual([]);
    expect((await post('/private/plan', asAda)).status).toBe(201);
    expect((await post('/open')).status).toBe(201);
  });

  it('keeps protected pages out of the sitemap and marks them noindex', async () => {
    const site = await getSite({ root });
    const xml = await (await sitemapResponse(site)).text();
    expect(xml).toContain('https://docs.acme.dev/open');
    expect(xml).not.toContain('private');
    const plan = site.find(['private', 'plan'])!;
    expect(site.isProtected(plan)).toBe(true);
    expect(pageMetadata(site, plan).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(pageMetadata(site, site.find(['open'])!).robots).toBeUndefined();
  });

  it('keeps protected pages out of the graph', async () => {
    const graph = await (await getSite({ root })).graph();
    expect(graph.nodes.map((n) => n.path).sort()).toEqual(['/', '/open']);
    expect(graph.edges).toEqual([]);
  });

  it('keeps protected pages out of an open book, and puts them in a protected one', async () => {
    expect(
      (await (await getSite({ root })).book()).map((b) => b.page.path).sort(),
    ).toEqual(['/', '/open']);
    await config({
      access: {
        rules: [{ paths: ['/private/**', '/print'], require: 'basic' }],
      },
    });
    expect(
      (await (await getSite({ root })).book()).map((b) => b.page.path).sort(),
    ).toEqual(['/', '/open', '/private/plan']);
  });
});
