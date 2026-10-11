import { buildContentIndex } from '@dockudos/core';
import { describe, expect, it } from 'vitest';
import { extractSymbols, isRelevantCodeFile, mapChangesToPages } from './agent-map.ts';

const pages = [
  { path: '/guides/webhooks', title: 'Webhooks', body: '# Webhooks\n\nSet `WEBHOOK_SECRET` and call `verifySignature` on every delivery.\n\n```bash\ndockudos hooks --retry-limit 3\n```\n' },
  { path: '/guides/auth', title: 'Authentication', body: '# Authentication\n\nSign in with OIDC. Set `AUTH_ISSUER` to your provider.\n' },
  { path: '/guides/install', title: 'Install', body: '# Install\n\nRun `npm install`. Nothing else is needed.\n' },
  { path: '/reference/api', title: 'API', body: '# API\n\nGET /api/v1/builds returns the builds of a site.\n' },
];
const index = buildContentIndex(pages).index;

describe('relevance', () => {
  it('ignores tests, lockfiles, build output and assets', () => {
    for (const p of ['src/a.spec.ts', 'pnpm-lock.yaml', 'dist/x.js', 'tests/e2e/a.ts', 'logo.png', 'CHANGELOG.md', 'node_modules/x/y.js']) expect(isRelevantCodeFile(p), p).toBe(false);
    for (const p of ['src/hooks/webhooks.ts', 'cmd/main.go', 'lib/auth.py']) expect(isRelevantCodeFile(p), p).toBe(true);
  });
});

describe('symbol extraction', () => {
  it('finds env vars, flags, declarations and routes; separates removed from added', () => {
    const s = extractSymbols([{
      path: 'src/webhooks.ts', status: 'modified',
      patch: [
        '-const secret = process.env.WEBHOOK_SECRET;', '+const secret = process.env.HOOKS_SIGNING_KEY;',
        '+export async function verifyDelivery(req) {}', '+  retryLimit: 3,', "+app.get('/api/v1/builds', h);", '+  .option("--retry-limit")',
        '-export function verifySignature() {}',
      ].join('\n'),
    }]);
    expect([...s.added].sort()).toEqual(['--retry-limit', '/api/v1/builds', 'HOOKS_SIGNING_KEY', 'retryLimit', 'verifyDelivery'].sort());
    expect([...s.removed].sort()).toEqual(['WEBHOOK_SECRET', 'verifySignature']);
    expect([...s.terms]).toContain('webhooks');
  });

  it('skips common words, short names and ignored files', () => {
    const s = extractSymbols([
      { path: 'src/a.ts', status: 'modified', patch: '+const data = 1;\n+function run() {}\n+let value = 2;' },
      { path: 'src/a.spec.ts', status: 'modified', patch: '+export function onlyInTests() {}' },
    ]);
    expect(s.added.size).toBe(0);
  });
});

describe('mapping a change to pages', () => {
  it('flags the page that documents a removed env var and the renamed function', () => {
    const hits = mapChangesToPages(index, [{ path: 'src/hooks.ts', status: 'modified', patch: '-process.env.WEBHOOK_SECRET\n+process.env.HOOKS_SIGNING_KEY\n-export function verifySignature() {}\n+export function verifyDelivery() {}' }]);
    expect(hits.map((h) => h.path)).toEqual(['/guides/webhooks']);
    expect(hits[0]!.reasons).toEqual(expect.arrayContaining(['removes `WEBHOOK_SECRET`', 'removes `verifySignature`']));
  });

  it('flags the page that documents a flag or a route', () => {
    expect(mapChangesToPages(index, [{ path: 'src/cli.ts', status: 'modified', patch: '+.option("--retry-limit <n>")' }])[0]!.path).toBe('/guides/webhooks');
    expect(mapChangesToPages(index, [{ path: 'src/routes.ts', status: 'modified', patch: "+router.get('/api/v1/builds', list)" }])[0]!.path).toBe('/reference/api');
  });

  it('returns nothing for a change no page documents, or for a pure test change', () => {
    expect(mapChangesToPages(index, [{ path: 'src/internal/cache.ts', status: 'modified', patch: '+const hitRatio = 0;\n+export function evictOldest() {}' }])).toEqual([]);
    expect(mapChangesToPages(index, [{ path: 'src/a.spec.ts', status: 'modified', patch: '+process.env.WEBHOOK_SECRET' }])).toEqual([]);
    expect(mapChangesToPages(index, [])).toEqual([]);
  });

  it('caps the number of pages and ranks by evidence', () => {
    const many = buildContentIndex(Array.from({ length: 8 }, (_, i) => ({ path: `/p${i}`, title: `P${i}`, body: `# P${i}\n\nUse \`SHARED_FLAG\` ${'and `SHARED_FLAG` '.repeat(i)}\n` }))).index;
    const hits = mapChangesToPages(many, [{ path: 'src/a.ts', status: 'modified', patch: '+process.env.SHARED_FLAG' }], { maxPages: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[2]!.score);
  });
});
