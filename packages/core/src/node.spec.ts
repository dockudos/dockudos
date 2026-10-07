import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocsConfigError } from './lib/config.ts';
import { discoverPages, loadConfig } from './node.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-core-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('loads a valid docs.json', async () => {
    await writeFile(join(dir, 'docs.json'), JSON.stringify({ name: 'X' }));
    await expect(loadConfig(dir)).resolves.toMatchObject({ name: 'X' });
  });

  it('fails clearly when the file is missing', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/file not found/);
  });

  it('fails clearly on invalid JSON', async () => {
    await writeFile(join(dir, 'docs.json'), '{ nope');
    await expect(loadConfig(dir)).rejects.toThrow(/not valid JSON/);
  });

  it('fails with the key name on a bad config', async () => {
    await writeFile(join(dir, 'docs.json'), '{}');
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(DocsConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/name:/);
  });
});

describe('discoverPages', () => {
  it('walks nested folders', async () => {
    await mkdir(join(dir, 'guides'));
    await writeFile(join(dir, 'index.mdx'), '# hi');
    await writeFile(join(dir, 'guides', 'auth.mdx'), '# auth');
    await writeFile(join(dir, 'logo.svg'), '');
    const tree = await discoverPages(dir);
    expect(tree.pages.map((p) => p.path)).toEqual(['/', '/guides/auth']);
  });
});
