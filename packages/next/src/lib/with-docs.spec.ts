import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDocs } from './with-docs.ts';

let root: string;
const writeConfig = (config: unknown) =>
  writeFile(join(root, 'docs.json'), JSON.stringify(config));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-next-'));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'index.mdx'), '# Home');
  await writeConfig({ name: 'Test' });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const docs = (config = {}) => withDocs(config, { root });

describe('withDocs', () => {
  it('adds md and mdx page extensions to the defaults', () => {
    expect(docs().pageExtensions).toEqual([
      'js',
      'jsx',
      'ts',
      'tsx',
      'md',
      'mdx',
    ]);
  });

  it('extends, not replaces, user page extensions without duplicating', () => {
    expect(docs({ pageExtensions: ['tsx', 'mdx'] }).pageExtensions).toEqual([
      'tsx',
      'mdx',
      'md',
    ]);
  });

  it('preserves the user config fields', () => {
    const config = docs({
      reactStrictMode: true,
      images: { unoptimized: true },
      env: { A: '1' },
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    expect(config.env).toEqual({ A: '1' });
  });

  it('does not mutate the input', () => {
    const input = { pageExtensions: ['tsx'] };
    docs(input);
    expect(input.pageExtensions).toEqual(['tsx']);
  });

  it('wires an MDX loader into webpack', () => {
    expect(typeof docs().webpack).toBe('function');
  });

  it('wires the dockudos pipeline into Turbopack when it is active', () => {
    vi.stubEnv('TURBOPACK', '1');
    try {
      const rules = JSON.stringify(docs().turbopack?.rules);
      expect(rules).toContain('remark-include');
      expect(rules).toContain('remark-admonitions');
      expect(rules).toContain('rehype-slug');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('withDocs: loader options', () => {
  it('are JSON-serializable, which Turbopack requires (no undefined values)', () => {
    vi.stubEnv('TURBOPACK', '1');
    try {
      const rules = docs().turbopack?.rules as Record<
        string,
        { loaders: { options: object }[] }[]
      >;
      const options = Object.values(rules)
        .flat()
        .flatMap((r) => r.loaders.map((l) => l.options));
      expect(options.length).toBeGreaterThan(0);
      // `toStrictEqual` treats an `undefined` property as a difference, which is what JSON drops.
      expect(JSON.parse(JSON.stringify(options))).toStrictEqual(options);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('withDocs: docs.json', () => {
  it('fails at call time with the key name when docs.json is invalid', async () => {
    await writeConfig({ theme: { layout: 'wide' } });
    expect(() => docs()).toThrow(/name:[\s\S]*theme\.layout/);
  });

  it('fails clearly when docs.json is missing', async () => {
    await rm(join(root, 'docs.json'));
    expect(() => docs()).toThrow(/file not found/);
  });
});

describe('withDocs: redirects', () => {
  it('serves redirects from docs.json after the user ones', async () => {
    await writeConfig({
      name: 'T',
      redirects: [{ source: '/old', destination: '/new' }],
    });
    const config = docs({
      redirects: async () => [
        { source: '/mine', destination: '/x', permanent: false },
      ],
    });
    expect(await config.redirects?.()).toEqual([
      { source: '/mine', destination: '/x', permanent: false },
      { source: '/old', destination: '/new', permanent: true },
    ]);
  });

  it('returns no redirects when there are none', async () => {
    expect(await docs().redirects?.()).toEqual([]);
  });

  it('rejects loops and redirects that shadow a page', async () => {
    await writeConfig({
      name: 'T',
      redirects: [
        { source: '/a', destination: '/b' },
        { source: '/b', destination: '/a' },
        { source: '/', destination: '/elsewhere' },
      ],
    });
    await expect(docs().redirects?.()).rejects.toThrow(
      /existing page[\s\S]*loop/,
    );
  });
});
