import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './config.ts';
import { publicIndex } from './index-filter.ts';
import { discoverPages } from '../node.ts';
import {
  INDEX_FILE,
  buildSiteIndex,
  readIndexFile,
  writeIndexFile,
} from './site-index.ts';

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

async function site() {
  const tree = await discoverPages(join(root, 'docs'));
  return { root, config, tree };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-index-'));
  await write('docs/index.mdx', '---\ntitle: Home\n---\n\nWelcome.\n');
  await write(
    'docs/guide.mdx',
    '---\ntitle: Guide\ndescription: A guide\n---\n\n<include>/_snippets/shared.mdx</include>\n\n## Setup\n\nInstall it.\n',
  );
  await write('docs/_snippets/shared.mdx', 'Shared text.\n');
  await write(
    'docs/secret.mdx',
    '---\ntitle: Secret\nhidden: true\n---\n\nHidden.\n',
  );
  await write('docs/private/p.mdx', '---\ntitle: P\n---\n\nPrivate.\n');
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('buildSiteIndex', () => {
  it('indexes pages that are not hidden, behind a rule or not, and expands includes', async () => {
    const { index } = await buildSiteIndex(await site());
    expect(index.pages.map((p) => p.path)).toEqual([
      '/',
      '/guide',
      '/private/p',
    ]);
    const texts = index.chunks.map((c) => c.text).join('\n');
    expect(texts).toContain('Shared text.');
    expect(texts).not.toMatch(/Hidden/);
  });

  it('has a public form without the protected pages or their text', async () => {
    const s = await site();
    const { index } = await buildSiteIndex(s);
    const open = publicIndex(index, {
      access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
    });
    expect(open.pages.map((p) => p.path)).toEqual(['/', '/guide']);
    expect(open.chunks.map((c) => c.text).join('\n')).not.toMatch(/Private/);
    expect(index.pages).toHaveLength(3);
  });

  it('writes the index file and reuses it on the next build', async () => {
    const first = await buildSiteIndex(await site());
    const file = await writeIndexFile(root, first.index);
    expect(file).toBe(join(root, INDEX_FILE));
    expect(JSON.parse(await readFile(file, 'utf8')).pages).toHaveLength(3);
    expect(await readIndexFile(root)).toEqual(first.index);

    await write('docs/guide.mdx', '---\ntitle: Guide\n---\n\nChanged.\n');
    const second = await buildSiteIndex(await site());
    expect(second.reusedPages).toBe(2);
    expect(second.rebuiltPages).toBe(1);
  });

  it('treats a missing or corrupt file as no previous index', async () => {
    expect(await readIndexFile(root)).toBeUndefined();
    await write(INDEX_FILE, '{not json');
    expect(await readIndexFile(root)).toBeUndefined();
    expect((await buildSiteIndex(await site())).reusedPages).toBe(0);
  });
});
