import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPages } from '../node.ts';
import { parseConfig } from './config.ts';
import { createSiteBackend } from './mcp-site.ts';
import { writeIndexFile, buildSiteIndex } from './site-index.ts';

let root: string;

async function write(file: string, text: string) {
  const full = join(root, file);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text);
}

const config = parseConfig({
  name: 'Site',
  access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-mcp-site-'));
  await write('docs/index.mdx', '---\ntitle: Home\n---\n\nWelcome aboard.\n');
  await write(
    'docs/guide.mdx',
    '---\ntitle: Guide\ndescription: A guide\n---\n\n## Setup\n\nInstall the zebra package.\n',
  );
  await write('docs/private/secret.mdx', '---\ntitle: Secret\n---\n\nHidden.\n');
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('createSiteBackend', () => {
  it('builds the index when there is none, then searches, lists and reads', async () => {
    const tree = await discoverPages(join(root, 'docs'));
    const backend = await createSiteBackend({ root, config, tree });

    const hits = await backend.search('zebra', { limit: 3 });
    expect(hits[0]?.path).toBe('/guide');

    const listed = await backend.listPages();
    expect(listed).toContainEqual({
      path: '/guide',
      title: 'Guide',
      description: 'A guide',
    });
    expect(listed.map((p) => p.path)).not.toContain('/private/secret');

    const page = await backend.getPage('/guide');
    expect(page).toMatchObject({ path: '/guide', title: 'Guide' });
    expect((page as { markdown: string }).markdown).toContain('zebra');
  });

  it('uses the index file that the build wrote', async () => {
    const tree = await discoverPages(join(root, 'docs'));
    const { index } = await buildSiteIndex({
      root,
      docsDir: join(root, 'docs'),
      config,
      tree,
    });
    await writeIndexFile(root, index);
    const backend = await createSiteBackend({
      root,
      docsDir: join(root, 'docs'),
      config,
      tree,
    });
    expect((await backend.search('zebra', { limit: 1 })).length).toBe(1);
  });

  it('does not show protected pages, and knows when a page is missing', async () => {
    const tree = await discoverPages(join(root, 'docs'));
    const backend = await createSiteBackend({ root, config, tree });
    expect(await backend.getPage('/private/secret')).toBe('forbidden');
    expect(await backend.getPage('/nope')).toBeUndefined();
  });
});
