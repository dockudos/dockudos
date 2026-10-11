import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db.ts';
import { createTestDb } from './testing/pglite.ts';
import { createFixture } from './testing/platform-fixture.ts';

let db: Db;
beforeAll(async () => (db = await createTestDb()));
afterAll(() => db.close());

describe('sites', () => {
  it('creates, lists, finds, rotates the webhook secret and removes', async () => {
    const f = await createFixture(db);
    expect(f.site.defaultBranch).toBe('main');
    expect((await f.sites.list(f.actor, f.team.id)).map((s) => s.id)).toContain(f.site.id);
    expect((await f.sites.bySlug(f.site.slug))?.id).toBe(f.site.id);
    expect(await f.sites.bySlug('nope')).toBeUndefined();
    expect(f.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    const next = await f.sites.rotateWebhookSecret(f.actor, f.site.id);
    expect(next).not.toBe(f.webhookSecret);
    expect((await f.sites.internal(f.site.id)).webhookSecret).toBe(next);
    await f.sites.remove(f.actor, f.site.id);
    await expect(f.sites.get(f.actor, f.site.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.sites.internal(f.site.id)).rejects.toMatchObject({ status: 404 });
  });

  it('gives sites with the same name different slugs and refuses the same folder twice', async () => {
    const f = await createFixture(db);
    f.git.seed(`${f.repo}-2`, { 'docs.json': '{}' });
    const again = await f.sites.create(f.actor, f.team.id, { name: f.site.name, provider: 'github', repo: `${f.repo}-2` });
    expect(again.site.slug).toBe(`${f.site.slug}-2`);
    await expect(f.sites.create(f.actor, f.team.id, { name: 'Dup', provider: 'github', repo: f.repo })).rejects.toMatchObject({ status: 409 });
  });

  it('validates input and reachability before saving anything', async () => {
    const f = await createFixture(db);
    const create = (over: object) => f.sites.create(f.actor, f.team.id, { name: 'X', provider: 'github', repo: f.repo, ...over } as never);
    await expect(create({ name: ' ' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ provider: 'bitbucket' })).rejects.toMatchObject({ code: 'provider_not_configured' });
    await expect(create({ repo: 'not a repo' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ docsDir: '../escape' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ docsDir: 'a/./b' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ repo: 'ghost/missing', name: 'G' })).rejects.toMatchObject({ code: 'repo_unreachable' });
    await expect(create({ defaultBranch: 'nope', name: 'H' })).rejects.toMatchObject({ code: 'repo_unreachable' });
    expect((await db.query("SELECT 1 FROM sites WHERE name IN ('G','H')")).rowCount).toBe(0);
  });

  it('keeps one team out of another, and normalizes the docs folder', async () => {
    const f = await createFixture(db);
    const other = await createFixture(db);
    await expect(f.sites.get(other.actor, f.site.id)).rejects.toMatchObject({ status: 403 });
    await expect(f.sites.list(other.actor, f.team.id)).rejects.toMatchObject({ status: 403 });
    await expect(f.sites.remove(other.actor, f.site.id)).rejects.toMatchObject({ status: 403 });
    f.git.seed(`${f.repo}-m`, { 'docs/docs.json': '{}' });
    const mono = await f.sites.create(f.actor, f.team.id, { name: 'Mono', provider: 'github', repo: `${f.repo}-m`, docsDir: '/docs/' });
    expect(mono.site.docsDir).toBe('docs');
  });
});
