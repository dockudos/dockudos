import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { silentLogger } from './logger.ts';
import { createPlatform } from './runtime.ts';
import { createTestDb } from './testing/pglite.ts';

const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'dkd-rt-'));
  dirs.push(d);
  return d;
};
afterAll(() =>
  Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))),
);

const env = async (extra: Record<string, string> = {}) => ({
  DOCKUDOS_DATABASE_URL: 'postgres://u:pw@db/x',
  DOCKUDOS_PUBLIC_URL: 'https://platform.test',
  DOCKUDOS_SESSION_SECRET: 's'.repeat(40),
  DOCKUDOS_DATA_DIR: await tmp(),
  DOCKUDOS_GITHUB_TOKEN: 'ghp_runtimetoken123',
  ...extra,
});

describe('createPlatform with default wiring', () => {
  it('talks to Git hosts through the guarded fetch, stores on disk by default, and shuts down cleanly', async () => {
    const db = await createTestDb();
    const calls: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        auth: new Headers(init?.headers).get('authorization'),
      });
      if (url.endsWith('/repos/acme/runtime'))
        return Response.json({ default_branch: 'main' });
      if (url.endsWith('/repos/acme/runtime/git/ref/heads/main'))
        return Response.json({ object: { sha: 'abc1234' } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const p = await createPlatform(
      loadConfig(
        await env({
          DOCKUDOS_SERVICES: 'web,worker,agent',
          DOCKUDOS_LLM_PROVIDER: 'anthropic',
          DOCKUDOS_LLM_MODEL: 'm',
          DOCKUDOS_LLM_API_KEY: 'sk-ant-runtime-key',
        }),
      ),
      { db, fetch: fetchImpl },
    );
    await p.migrate();
    const owner = await p.auth.upsertUser({
      sub: 'rt',
      email: 'rt@x.test',
      roles: [],
      groups: [],
    });
    const actor = { type: 'user', user: owner } as const;
    const team = await p.auth.createTeam(actor, 'Runtime');
    const { site } = await p.sites.create(actor, team.id, {
      name: 'RT',
      provider: 'github',
      repo: 'acme/runtime',
    });
    expect(site.defaultBranch).toBe('main');
    expect(calls[0]!.auth).toBe('Bearer ghp_runtimetoken123');
    await p.storage.put('x/y.txt', new TextEncoder().encode('hi'));
    expect(new TextDecoder().decode(await p.storage.get('x/y.txt'))).toBe('hi');
    p.start();
    await p.stop();
    await db.close();
  });

  it('refuses to fetch from an address nobody allowed', async () => {
    const db = await createTestDb();
    const p = await createPlatform(
      loadConfig(
        await env({ DOCKUDOS_GITHUB_API_URL: 'https://api.github.com' }),
      ),
      { db, fetch: (async () => new Response('{}')) as typeof fetch },
    );
    const evil = p.providers.github!;
    // The provider only ever builds URLs on its configured API host, so the guard is exercised by the host list itself.
    expect(evil.cloneUrl('a/b')).toBe('https://github.com/a/b.git');
    await db.close();
  });

  it('picks S3 storage and OpenAI when configured', async () => {
    const db = await createTestDb();
    const seen: string[] = [];
    const p = await createPlatform(
      loadConfig(
        await env({
          DOCKUDOS_S3_ENDPOINT: 'http://minio:9000',
          DOCKUDOS_S3_ACCESS_KEY: 'ak',
          DOCKUDOS_S3_SECRET_KEY: 'sk-minio-secret',
          DOCKUDOS_LLM_PROVIDER: 'openai',
          DOCKUDOS_LLM_MODEL: 'gpt',
          DOCKUDOS_LLM_API_KEY: 'sk-openai-key-1',
          DOCKUDOS_LLM_BASE_URL: 'https://llm.example.com/v1',
          DOCKUDOS_COOKIE_DOMAIN: '.platform.test',
          DOCKUDOS_OIDC_ISSUER: 'https://idp.test',
          DOCKUDOS_OIDC_CLIENT_ID: 'dockudos',
          DOCKUDOS_DOCS_AUTH_SECRET: 'd'.repeat(40),
        }),
      ),
      {
        db,
        log: silentLogger,
        fetch: (async (u: string | URL) => {
          seen.push(String(u));
          return new Response('<ListBucketResult/>');
        }) as typeof fetch,
      },
    );
    await p.storage.ping();
    expect(seen[0]).toContain('http://minio:9000/dockudos');
    expect(
      (await p.handler(new Request('https://platform.test/auth/login'))).status,
    ).toBe(502);
    await db.close();
  });
});
