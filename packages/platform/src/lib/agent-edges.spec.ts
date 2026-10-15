import { buildContentIndex, mockLLM, type LLMProvider } from '@dockudos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgent } from './agent.ts';
import type { Db } from './db.ts';
import { createWorker } from './queue.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

const page = (path: string, title: string, text: string) => ({
  path,
  title,
  body: `# ${title}\n\n${text}\n`,
  source: `---\ntitle: ${title}\n---\n\n# ${title}\n\n${text}\n`,
});

interface Opts {
  pages?: ReturnType<typeof page>[];
  /** Pages that exist in the built index but have no source file in the repo. */
  ghosts?: ReturnType<typeof page>[];
  llm?: LLMProvider;
  repoFiles?: Record<string, string>;
  codeRepos?: boolean;
}

async function setup(o: Opts = {}) {
  const pages = o.pages ?? [page('/guides/a', 'Alpha', 'Nothing special.')];
  const index = buildContentIndex(
    [...pages, ...(o.ghosts ?? [])].map(({ path, title, body }) => ({
      path,
      title,
      body,
    })),
  ).index;
  const f = await createFixture(db, { index });
  const codeRepo = `${f.repo}-code`;
  f.git.seed(codeRepo, { 'src/main.ts': 'export const keepMe = 1;' });
  f.git.push(f.repo, 'main', {
    ...Object.fromEntries(pages.map((p) => [`docs${p.path}.mdx`, p.source])),
    ...o.repoFiles,
  });
  await f.builds.rebuild(f.actor, f.site.id);
  await f.drain();
  const agent = createAgent({
    db,
    sites: f.sites,
    builds: f.builds,
    queue: f.queue,
    providers: f.providers,
    ...(o.llm && { llm: o.llm }),
    clock: f.clock,
    metrics: f.metrics,
  });
  await agent.configure(f.actor, f.site.id, {
    enabled: true,
    ...(o.codeRepos !== false && {
      codeRepos: [{ provider: 'github', repo: codeRepo }],
    }),
  });
  const worker = createWorker({
    queue: f.queue,
    handlers: { agent: agent.handle },
  });
  const drain = async () => {
    while (await worker.runOnce());
  };
  const latest = async (trigger: string) =>
    (await agent.listRuns(f.actor, f.site.id)).find(
      (r) => r.trigger === trigger,
    )!;
  return { f, agent, codeRepo, drain, latest };
}
type S = Awaited<ReturnType<typeof setup>>;

const run = async (s: S, kind: 'broken-links' | 'outdated-pages') => {
  await s.agent.trigger(s.f.actor, s.f.site.id, kind);
  await s.drain();
  return s.latest(kind);
};

describe('validation and dispatch', () => {
  it('rejects a code repository on a provider this instance does not have', async () => {
    const s = await setup();
    delete (s.f.providers as Record<string, unknown>)['gitlab'];
    await expect(
      s.agent.configure(s.f.actor, s.f.site.id, {
        codeRepos: [{ provider: 'gitlab', repo: 'a/b' }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not configured'),
    });
  });

  it('rejects an unknown automation kind', async () => {
    const s = await setup();
    await expect(
      s.agent.setAutomation(
        s.f.actor,
        s.f.site.id,
        'delete-everything' as never,
        {
          enabled: true,
        },
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Unknown automation.' });
  });

  it('rejects an interval that is not a whole number of hours, or is over 90 days', async () => {
    const s = await setup();
    for (const intervalHours of [1.5, 2161, -3]) {
      await expect(
        s.agent.setAutomation(s.f.actor, s.f.site.id, 'broken-links', {
          enabled: true,
          intervalHours,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await s.agent.setAutomation(s.f.actor, s.f.site.id, 'broken-links', {
      enabled: true,
      intervalHours: 2160,
    });
  });

  it('refuses an unknown job kind permanently', async () => {
    const s = await setup();
    await expect(
      s.agent.handle({ payload: { kind: 'mine-bitcoin' } } as never),
    ).rejects.toThrow('Unknown agent job "mine-bitcoin".');
  });

  it('exposes only runs of sites the actor can read', async () => {
    const s = await setup();
    const stranger = await s.f.auth.upsertUser({
      sub: `ag-${Math.random()}`,
      email: `ag${Math.random()}@x.test`,
      roles: [],
      groups: [],
    });
    const r = await run(s, 'broken-links');
    const as = { type: 'user', user: stranger } as const;
    await expect(s.agent.getRun(as, r.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.agent.listRuns(as, s.f.site.id)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('caps the number of runs returned', async () => {
    const s = await setup();
    await run(s, 'broken-links');
    expect(await s.agent.listRuns(s.f.actor, s.f.site.id, 0)).toEqual([]);
    expect((await s.agent.listRuns(s.f.actor, s.f.site.id, 1e6)).length).toBe(
      1,
    );
  });
});

describe('broken links', () => {
  it('flags a link to a heading that does not exist for a person, and changes nothing', async () => {
    const s = await setup({
      pages: [
        page('/guides/a', 'Alpha', 'See [beta](/guides/b#nope).'),
        page('/guides/b', 'Beta', 'Text.'),
      ],
    });
    const r = await run(s, 'broken-links');
    expect(r.status).toBe('flagged');
    expect(r.flagged[0]).toMatchObject({
      path: '/guides/a',
      outcome: 'needs a person',
    });
    expect(r.flagged[0]!.reasons[0]).toContain('#nope is not a heading');
    expect(s.f.git.pulls).toHaveLength(0);
  });

  it('accepts a link to a heading that does exist', async () => {
    const s = await setup({
      pages: [
        page('/guides/a', 'Alpha', 'See [beta](/guides/b#details).'),
        page('/guides/b', 'Beta', '## Details\n\nText.'),
      ],
    });
    const r = await run(s, 'broken-links');
    expect(r.status).toBe('no-changes');
    expect(r.flagged).toEqual([]);
  });

  it('honours the redirects in docs.json (with or without a trailing slash)', async () => {
    const s = await setup({
      pages: [
        page('/guides/a', 'Alpha', 'Old: [legacy](/legacy) [root](/old/).'),
      ],
      repoFiles: {
        'docs.json': JSON.stringify({
          redirects: [{ source: '/legacy/' }, { source: '/old' }],
        }),
      },
    });
    const r = await run(s, 'broken-links');
    expect(r.status).toBe('no-changes');
  });

  it('tolerates a docs.json that is not valid JSON by failing the run, not the process', async () => {
    const s = await setup({ repoFiles: { 'docs.json': '{ nope' } });
    await s.agent.trigger(s.f.actor, s.f.site.id, 'broken-links');
    await s.drain();
    const r = await s.latest('broken-links');
    expect(r.status).toBe('failed');
    expect(r.error).toBeTruthy();
  });

  it('skips pages whose source file is not in the repository', async () => {
    const s = await setup({
      ghosts: [page('/guides/ghost', 'Ghost', 'See [x](/nope).')],
    });
    const r = await run(s, 'broken-links');
    expect(r.status).toBe('no-changes');
  });

  it('ignores external links, images and anchors on the same page', async () => {
    const s = await setup({
      pages: [
        page(
          '/guides/a',
          'Alpha',
          '[ext](https://example.com/x) ![img](/nope.png) [top](#alpha) [mail](mailto:a@b.c)',
        ),
      ],
    });
    expect((await run(s, 'broken-links')).status).toBe('no-changes');
  });
});

describe('outdated pages', () => {
  it('says so when no code repository is connected', async () => {
    const s = await setup({ codeRepos: false });
    const r = await run(s, 'outdated-pages');
    expect(r).toMatchObject({
      status: 'no-changes',
      error: 'No code repositories are connected.',
    });
  });

  it('does nothing when every identifier on the page is in the code', async () => {
    const s = await setup({
      pages: [page('/guides/a', 'Alpha', 'Call `keepMe` to start.')],
    });
    const r = await run(s, 'outdated-pages');
    expect(r.status).toBe('no-changes');
  });

  it('skips a code repository whose provider is gone and pages without a source', async () => {
    const s = await setup({
      pages: [page('/guides/a', 'Alpha', 'Set `SOME_OLD_VAR`.')],
      ghosts: [page('/guides/ghost', 'Ghost', 'Set `GHOST_VAR`.')],
    });
    await db.query(
      `UPDATE site_settings SET code_repos = $2 WHERE site_id = $1`,
      [s.f.site.id, JSON.stringify([{ provider: 'gitlab', repo: 'x/y' }])],
    );
    delete (s.f.providers as Record<string, unknown>)['gitlab'];
    const r = await run(s, 'outdated-pages');
    // Nothing to compare against, so the live page is flagged; the ghost page has no source and is skipped.
    expect(r.status).toBe('flagged');
    expect(r.flagged.map((x) => x.path)).toEqual(['/guides/a']);
    expect(r.flagged[0]!.outcome).toBe('no model configured');
    expect(s.f.git.pulls).toHaveLength(0);
  });

  it('ignores identifiers that are not code-shaped (plain words, short spans)', async () => {
    const s = await setup({
      pages: [
        page('/guides/a', 'Alpha', 'Use `npm` and `the thing` and `ab`.'),
      ],
    });
    expect((await run(s, 'outdated-pages')).status).toBe('no-changes');
  });
});

describe('code changes', () => {
  const change = async (s: S, files: Record<string, string | null>) => {
    await s.agent.watch(s.f.site.id); // baseline
    s.f.git.push(s.codeRepo, 'main', files);
    await s.agent.watch(s.f.site.id);
    await s.drain();
    return s.latest('code-change');
  };

  it('records no change when only tests, lockfiles and images changed', async () => {
    const s = await setup();
    const r = await change(s, {
      'src/main.spec.ts': 'x',
      'pnpm-lock.yaml': 'x',
      'logo.png': 'x',
    });
    expect(r.status).toBe('no-changes');
  });

  it('records no change when no page is affected by the diff', async () => {
    const s = await setup();
    const r = await change(s, {
      'src/zzz.ts': 'export const unrelatedThing = 2;',
    });
    expect(r.status).toBe('no-changes');
  });

  it('flags a page whose source file is not in the repository', async () => {
    const s = await setup({
      ghosts: [
        page('/guides/ghost', 'Ghost', 'Set `LEGACY_FLAG` to enable it.'),
      ],
      llm: mockLLM(() => 'DECISION: NO_CHANGE\nRATIONALE: x'),
    });
    const r = await change(s, { 'src/flags.ts': 'const a = LEGACY_FLAG;' });
    expect(r.status).toBe('flagged');
    expect(r.flagged.map((x) => x.outcome)).toContain('source file not found');
  });

  it('fails the run, and says why, when the code repo provider is not configured', async () => {
    const s = await setup();
    delete (s.f.providers as Record<string, unknown>)['gitlab'];
    await expect(
      s.agent.handle({
        payload: {
          kind: 'code-change',
          siteId: s.f.site.id,
          provider: 'gitlab',
          codeRepo: 'a/b',
          baseSha: 'a',
          headSha: 'b',
        },
      } as never),
    ).rejects.toThrow('gitlab is not configured.');
    const r = await s.latest('code-change');
    expect(r).toMatchObject({ status: 'failed' });
    expect(r.error).toContain('gitlab is not configured');
  });

  it('truncates a very long failure message in the run record', async () => {
    const s = await setup();
    s.f.builds.liveIndex = async () => {
      throw new Error('x'.repeat(2000));
    };
    await expect(
      s.agent.handle({
        payload: {
          kind: 'broken-links',
          siteId: s.f.site.id,
        },
      } as never),
    ).rejects.toThrow();
    const r = await s.latest('broken-links');
    expect(r.error!.length).toBeLessThanOrEqual(500);
  });
});

describe('watching', () => {
  it('does nothing for a site with the agent off', async () => {
    const s = await setup();
    await s.agent.configure(s.f.actor, s.f.site.id, { enabled: false });
    expect(await s.agent.watch(s.f.site.id)).toBe(0);
  });

  it('skips a code repository whose provider is gone', async () => {
    const s = await setup();
    await db.query(
      `UPDATE site_settings SET code_repos = $2 WHERE site_id = $1`,
      [s.f.site.id, JSON.stringify([{ provider: 'gitlab', repo: 'x/y' }])],
    );
    delete (s.f.providers as Record<string, unknown>)['gitlab'];
    expect(await s.agent.watch(s.f.site.id)).toBe(0);
  });

  it('uses the branch a code repository is pinned to', async () => {
    const s = await setup();
    s.f.git.push(s.codeRepo, 'main', { 'a.ts': '1' });
    await s.agent.configure(s.f.actor, s.f.site.id, {
      codeRepos: [{ provider: 'github', repo: s.codeRepo, branch: 'main' }],
    });
    expect(await s.agent.watch(s.f.site.id)).toBe(0); // first sighting: baseline
    const runs = await s.agent.listRuns(s.f.actor, s.f.site.id);
    expect(runs.some((r) => r.trigger === 'baseline')).toBe(true);
  });
});
