// Build time and index size for a large multi-version, multi-language site.
// Usage: node tools/bench-scale.mjs [pagesPerVariant=1000]
// Needs `pnpm nx build core` first. Writes a throwaway site to the OS temp folder and prints a table.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { filterIndex, parseConfig } from '../packages/core/dist/index.js';
import { buildSiteIndex, discoverSite } from '../packages/core/dist/node.js';

const perVariant = Number(process.argv[2] ?? 1000);
const config = parseConfig({
  name: 'Bench',
  versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
  i18n: { default: 'en', locales: ['en', 'fr'] },
});
const root = await mkdtemp(join(tmpdir(), 'dockudos-bench-'));
const lorem =
  'The quick brown fox jumps over the lazy dog while the documentation explains authentication, pagination, rate limits and webhooks in plain words. ';

try {
  const started = performance.now();
  for (const version of ['v2', 'v1'])
    for (const locale of ['en', 'fr']) {
      for (let i = 0; i < perVariant; i++) {
        const dir = join(root, 'docs', version, locale, `section-${i % 25}`);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, `page-${i}.mdx`),
          `---\ntitle: Page ${i} (${version} ${locale})\ndescription: Page number ${i}\n---\n\n## Overview ${i}\n\n${lorem.repeat(4)}\n\n## Details\n\n${lorem.repeat(6)}\n\n### Example\n\n\`\`\`js\nconst page = ${i};\n\`\`\`\n`,
        );
      }
    }
  const written = performance.now() - started;

  const time = async (label, fn) => {
    const t = performance.now();
    const value = await fn();
    return { label, ms: Math.round(performance.now() - t), value };
  };

  const discovered = await time('discover pages', () =>
    discoverSite(join(root, 'docs'), config),
  );
  const first = await time('build index (cold)', () =>
    buildSiteIndex({
      root,
      docsDir: join(root, 'docs'),
      tree: discovered.value.tree,
    }),
  );
  const again = await time('build index (nothing changed)', () =>
    buildSiteIndex({
      root,
      docsDir: join(root, 'docs'),
      tree: discovered.value.tree,
      previous: first.value.index,
    }),
  );
  const index = first.value.index;
  const size = (v) => Buffer.byteLength(JSON.stringify(v));
  const scoped = filterIndex(
    index,
    (p) => p.version === 'v2' && p.locale === 'en',
  );

  const rows = [
    ['pages', discovered.value.tree.pages.length],
    ['chunks', index.chunks.length],
    ...[discovered, first, again].map((r) => [r.label, `${r.ms} ms`]),
    ['whole index', `${(size(index) / 1e6).toFixed(1)} MB`],
    [
      'index a browser downloads (one version and language)',
      `${(size(scoped) / 1e6).toFixed(1)} MB (${scoped.pages.length} pages)`,
    ],
    ['(writing the fixture)', `${Math.round(written)} ms`],
  ];
  const width = Math.max(...rows.map((r) => String(r[0]).length));
  for (const [k, v] of rows) console.log(`${String(k).padEnd(width)}  ${v}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
