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
    expect(config.env?.['A']).toBe('1');
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

describe('withDocs: access rules', () => {
  it("puts the rules, and no secrets, in the build environment next to the user's env", async () => {
    await writeConfig({
      name: 'T',
      access: {
        rules: [
          { paths: ['/private/**'], require: 'basic', secretEnv: 'DOCS_PW' },
        ],
      },
    });
    const config = docs({ env: { MINE: '1' } });
    expect(config.env?.['MINE']).toBe('1');
    expect(JSON.parse(config.env!['DOCKUDOS_ACCESS']!)).toEqual([
      { paths: ['/private/**'], require: 'basic', secretEnv: 'DOCS_PW' },
    ]);
  });

  it('carries an empty list when nothing is protected', () => {
    expect(docs().env?.['DOCKUDOS_ACCESS']).toBe('[]');
  });
});

describe('withDocs: Markdown twins', () => {
  type Rewrites = {
    beforeFiles: { source: string; destination: string; has?: unknown[] }[];
    afterFiles: unknown[];
    fallback: unknown[];
  };
  const rewrites = async (config = {}) =>
    (await docs(config).rewrites?.()) as Rewrites;

  it('rewrites .md addresses and Accept: text/markdown to the markdown route', async () => {
    const { beforeFiles } = await rewrites();
    expect(beforeFiles.map((r) => r.destination)).toEqual([
      '/api/markdown',
      '/api/markdown',
      '/api/markdown',
    ]);
    expect(beforeFiles[0]?.source).toBe('/:path(.+)\\.md');
    for (const r of beforeFiles.slice(1))
      expect(r.has).toEqual([
        { type: 'header', key: 'accept', value: '.*text/markdown.*' },
      ]);
  });

  it('keeps the user rewrites, array or object, after its own', async () => {
    const mine = { source: '/a', destination: '/b' };
    const asArray = await rewrites({ rewrites: async () => [mine] });
    expect(asArray.afterFiles).toEqual([mine]);
    const asObject = await rewrites({
      rewrites: async () => ({
        beforeFiles: [mine],
        afterFiles: [],
        fallback: [mine],
      }),
    });
    expect(asObject.beforeFiles.at(-1)).toEqual(mine);
    expect(asObject.beforeFiles).toHaveLength(4);
    expect(asObject.fallback).toEqual([mine]);
  });

  it('matches the paths it should: .md, never /api, /_next or files', async () => {
    const { beforeFiles } = await rewrites();
    const [twin, , negotiated] = beforeFiles;
    const match = (source: string | undefined, path: string) =>
      new RegExp(
        `^${(source ?? '')
          .replace('/:path(.+)', '/(.+)')
          .replace(
            '/:path((?!api/|_next/)[^.]*)',
            '/((?!api/|_next/)[^.]*)',
          )}$`,
      ).test(path);
    expect(match(twin?.source, '/guides/auth.md')).toBe(true);
    expect(match(twin?.source, '/guides/auth')).toBe(false);
    expect(match(negotiated?.source, '/guides/auth')).toBe(true);
    expect(match(negotiated?.source, '/api/search')).toBe(false);
    expect(match(negotiated?.source, '/_next/data/x')).toBe(false);
    expect(match(negotiated?.source, '/logo.svg')).toBe(false);
  });
});

describe('withDocs: the embeddable assistant', () => {
  const headers = async (config = {}) => docs(config).headers?.();

  it('lets only the site itself frame /embed, until origins are listed', async () => {
    expect(await headers()).toEqual([
      {
        source: '/embed',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ]);
  });

  it('lets the listed origins frame it, after the user’s own headers', async () => {
    await writeConfig({
      name: 'Test',
      ai: { allowedOrigins: ['https://app.acme.com', 'http://localhost:3000'] },
    });
    const mine = { source: '/x', headers: [{ key: 'X-A', value: '1' }] };
    const out = await headers({ headers: async () => [mine] });
    expect(out?.[0]).toEqual(mine);
    expect(out?.[1]?.headers[0]?.value).toBe(
      "frame-ancestors 'self' https://app.acme.com http://localhost:3000",
    );
  });
});

describe('withDocs: static export', () => {
  afterEach(() => {
    delete process.env.DOCKUDOS_STATIC;
    delete process.env.DOCKUDOS_BASE_PATH;
  });

  it('does nothing different unless `dockudos build --static` asked for it', () => {
    const config = docs();
    expect(config.output).toBeUndefined();
    expect(config.rewrites).toBeDefined();
  });

  it('exports plain files, without the settings export cannot use', () => {
    process.env.DOCKUDOS_STATIC = '1';
    const config = docs({ images: { formats: ['image/webp'] } });
    expect(config.output).toBe('export');
    expect(config.trailingSlash).toBe(true);
    expect(config.images).toEqual({
      formats: ['image/webp'],
      unoptimized: true,
    });
    expect(config.basePath).toBeUndefined();
    expect(config.rewrites).toBeUndefined();
    expect(config.headers).toBeUndefined();
    expect(config.redirects).toBeUndefined();
    expect(config.env).toMatchObject({
      NEXT_PUBLIC_DOCKUDOS_STATIC: '1',
      NEXT_PUBLIC_DOCKUDOS_BASE_PATH: '',
    });
    expect(config.pageExtensions).toContain('mdx');
  });

  it('serves from a sub-path and tells the browser', () => {
    process.env.DOCKUDOS_STATIC = '1';
    process.env.DOCKUDOS_BASE_PATH = 'demo/';
    const config = docs();
    expect(config.basePath).toBe('/demo');
    expect(config.env?.NEXT_PUBLIC_DOCKUDOS_BASE_PATH).toBe('/demo');
  });
});
