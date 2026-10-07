import {
  DocsConfigError,
  docsConfigJsonSchema,
  parseConfig,
} from './config.ts';

const messageOf = (input: unknown) => {
  try {
    parseConfig(input, 'docs.json');
  } catch (e) {
    expect(e).toBeInstanceOf(DocsConfigError);
    return (e as Error).message;
  }
  throw new Error('expected parseConfig to throw');
};

describe('parseConfig', () => {
  it('accepts a minimal config and defaults navigation', () => {
    expect(parseConfig({ name: 'Acme Docs' })).toEqual({
      name: 'Acme Docs',
      navigation: [],
      redirects: [],
      theme: { mode: 'system', layout: 'docs' },
      seo: { noindex: false },
      kudos: { enabled: false, endpoint: '/api/kudos' },
      search: { backend: 'builtin', limit: 10 },
      ai: {
        enabled: false,
        limits: {
          maxQuestionLength: 500,
          maxOutputTokens: 800,
          ratePerMinute: 10,
          maxHistoryTurns: 6,
          contextTokens: 3000,
        },
      },
      actions: {
        copyPage: false,
        assistants: false,
        endpoint: '/api/markdown',
      },
      shortcuts: true,
      icons: { packs: {} },
      access: { rules: [] },
    });
  });

  it('accepts tabs, groups and pages', () => {
    const config = {
      name: 'Acme',
      navigation: [
        {
          tab: 'Guides',
          groups: [{ group: 'Start', pages: ['index', 'a/b'] }],
        },
      ],
    };
    expect(parseConfig(config).navigation).toEqual(config.navigation);
  });

  it('names the key when `name` is missing', () => {
    expect(messageOf({})).toContain('name:');
  });

  it('names the source file', () => {
    expect(messageOf({})).toContain('in docs.json');
  });

  it('rejects an empty name', () => {
    expect(messageOf({ name: '' })).toContain('name:');
  });

  it('rejects unknown keys by name (strict)', () => {
    expect(messageOf({ name: 'x', nav: [] })).toContain('unknown key nav');
  });

  it('gives a nested path for bad navigation entries', () => {
    const msg = messageOf({
      name: 'x',
      navigation: [{ tab: 'T', groups: [{ group: 'G', pages: [1] }] }],
    });
    expect(msg).toContain('navigation[0].groups[0].pages[0]');
  });

  it('reports every problem, not only the first', () => {
    const e = new DocsConfigError(['a', 'b']);
    expect(e.issues).toEqual(['a', 'b']);
    expect(() => parseConfig({ name: 1, extra: true })).toThrow(
      /name:[\s\S]*unknown key extra/,
    );
  });

  it('rejects non-object input', () => {
    expect(messageOf('nope')).toContain('(root)');
  });
});

describe('parseConfig: full schema', () => {
  it('accepts every top-level key', () => {
    const config = parseConfig({
      $schema: './docs.schema.json',
      name: 'Acme',
      logo: { light: '/l.svg', dark: '/d.svg', href: '/' },
      favicon: '/favicon.ico',
      theme: {
        primary: '#3b82f6',
        mode: 'dark',
        layout: 'notebook',
        fonts: { sans: 'Inter' },
        radius: '0.5rem',
        css: 'custom.css',
      },
      navigation: [
        {
          tab: 'Guides',
          groups: [
            {
              group: 'Start',
              pages: [
                'index',
                { title: 'GitHub', href: 'https://github.com/acme' },
                { group: 'Nested', pages: ['a/b'] },
              ],
            },
          ],
        },
        { tab: 'Blog', href: 'https://blog.acme.com' },
      ],
      redirects: [{ source: '/old', destination: '/new' }],
      seo: { siteUrl: 'https://docs.acme.com', noindex: true },
    });
    expect(config.redirects[0]?.permanent).toBe(true);
    expect(config.theme.layout).toBe('notebook');
  });

  it.each([
    ['theme.primary', { theme: { primary: 'blue' } }],
    ['theme.layout', { theme: { layout: 'wide' } }],
    ['theme.mode', { theme: { mode: 'auto' } }],
    [
      'redirects[0].source',
      { redirects: [{ source: 'old', destination: '/n' }] },
    ],
    [
      'redirects[0].destination',
      { redirects: [{ source: '/o', destination: 'new' }] },
    ],
    ['seo.siteUrl', { seo: { siteUrl: 'not a url' } }],
    ['logo', { logo: 42 }],
    [
      'navigation[0].groups[0].group',
      { navigation: [{ tab: 'T', groups: [{ pages: [] }] }] },
    ],
  ])('names %s when invalid', (key, patch) => {
    expect(messageOf({ name: 'A', ...patch })).toContain(key);
  });

  it('names an unknown nested key', () => {
    expect(messageOf({ name: 'A', theme: { colour: 'red' } })).toContain(
      'unknown key theme.colour',
    );
  });

  it('exports a JSON Schema that describes the keys', () => {
    const schema = docsConfigJsonSchema() as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'name',
        'theme',
        'navigation',
        'redirects',
        'seo',
      ]),
    );
  });
});

describe('parseConfig: theme values that reach CSS', () => {
  it.each([
    [
      'theme.fonts.sans',
      { theme: { fonts: { sans: 'x}</style><script>alert(1)</script>' } } },
    ],
    ['theme.fonts.mono', { theme: { fonts: { mono: 'a; b' } } }],
    ['theme.radius', { theme: { radius: '1rem; } body { display: none' } }],
  ])(
    'rejects characters that could break out of a declaration in %s',
    (key, patch) => {
      expect(messageOf({ name: 'A', ...patch })).toContain(key);
    },
  );

  it('still accepts ordinary font stacks and lengths', () => {
    const { theme } = parseConfig({
      name: 'A',
      theme: {
        fonts: { sans: "Inter, 'Helvetica Neue', system-ui, sans-serif" },
        radius: 'calc(0.5rem + 2px)',
      },
    });
    expect(theme.fonts?.sans).toContain('Helvetica Neue');
    expect(theme.radius).toBe('calc(0.5rem + 2px)');
  });
});

describe('parseConfig: kudos', () => {
  it('is off by default and takes an endpoint', () => {
    expect(parseConfig({ name: 'A' }).kudos).toEqual({
      enabled: false,
      endpoint: '/api/kudos',
    });
    expect(
      parseConfig({ name: 'A', kudos: { enabled: true, endpoint: '/fb' } })
        .kudos,
    ).toEqual({ enabled: true, endpoint: '/fb' });
  });

  it('rejects an endpoint that is not a path, naming the key', () => {
    expect(
      messageOf({ name: 'A', kudos: { endpoint: 'https://x.dev' } }),
    ).toContain('kudos.endpoint');
  });
});

describe('parseConfig: actions and shortcuts', () => {
  it('accepts actions and an edit link with a placeholder', () => {
    const c = parseConfig({
      name: 'A',
      actions: {
        copyPage: true,
        assistants: true,
        editUrl: 'https://github.com/a/b/edit/main/docs/{file}',
      },
      shortcuts: false,
    });
    expect(c.actions.copyPage).toBe(true);
    expect(c.shortcuts).toBe(false);
  });

  it.each(['https://github.com/a/b', 'github.com/{file}', 'ftp://x/{file}'])(
    'rejects editUrl %j',
    (editUrl) => {
      expect(messageOf({ name: 'A', actions: { editUrl } })).toContain(
        'actions.editUrl',
      );
    },
  );
});

describe('parseConfig: access', () => {
  it('accepts rules for each way of requiring access', () => {
    const c = parseConfig({
      name: 'A',
      access: {
        rules: [
          { paths: ['/print'], require: 'basic', realm: 'Team docs' },
          {
            paths: ['/internal/**', '/api/*'],
            require: 'token',
            secretEnv: 'DOCS_TOKEN',
          },
          { paths: ['/draft'], require: 'deny' },
          { paths: ['/members/**'], require: 'custom' },
        ],
      },
    });
    expect(c.access.rules).toHaveLength(4);
  });

  it.each([
    ['no paths', { paths: [], require: 'basic' }, 'access.rules[0].paths'],
    [
      'a path without a slash',
      { paths: ['print'], require: 'basic' },
      'access.rules[0].paths[0]',
    ],
    [
      'a wildcard in the middle of a name',
      { paths: ['/a*b'], require: 'basic' },
      'access.rules[0].paths[0]',
    ],
    [
      '** that is not last',
      { paths: ['/a/**/b'], require: 'basic' },
      'access.rules[0].paths[0]',
    ],
    [
      'an unknown way',
      { paths: ['/a'], require: 'magic' },
      'access.rules[0].require',
    ],
    [
      'a secret name that is not a variable',
      { paths: ['/a'], require: 'basic', secretEnv: 'my secret' },
      'access.rules[0].secretEnv',
    ],
    [
      'an unknown key',
      { paths: ['/a'], require: 'basic', password: 'x' },
      'access.rules[0]',
    ],
  ])('rejects %s, naming the key', (_name, ruleValue, key) => {
    expect(messageOf({ name: 'A', access: { rules: [ruleValue] } })).toContain(
      key,
    );
  });
});

describe('parseConfig: icons', () => {
  it('accepts a folder or an object per pack', () => {
    const c = parseConfig({
      name: 'A',
      icons: {
        packs: {
          acme: 'icons/acme',
          brand: { dir: 'icons/brand', monochrome: true },
        },
      },
    });
    expect(c.icons.packs['acme']).toBe('icons/acme');
    expect(c.icons.packs['brand']).toEqual({
      dir: 'icons/brand',
      monochrome: true,
    });
  });

  it.each([
    ['an uppercase prefix', { Acme: 'x' }, 'icons.packs'],
    ['a prefix with a colon', { 'a:b': 'x' }, 'icons.packs'],
    ['an empty folder', { acme: '' }, 'icons.packs.acme'],
    [
      'an unknown pack key',
      { acme: { dir: 'x', colour: true } },
      'icons.packs.acme',
    ],
  ])('rejects %s, naming the key', (_name, packs, key) => {
    expect(messageOf({ name: 'A', icons: { packs } })).toContain(key);
  });
});

describe('parseConfig: urlPrefix', () => {
  it('accepts a mount point', () => {
    expect(parseConfig({ name: 'A', urlPrefix: '/docs' }).urlPrefix).toBe(
      '/docs',
    );
    expect(
      parseConfig({ name: 'A', urlPrefix: '/help/center' }).urlPrefix,
    ).toBe('/help/center');
    expect(parseConfig({ name: 'A' }).urlPrefix).toBeUndefined();
  });

  it.each(['docs', '/docs/', '/', '//docs'])(
    'rejects %j naming the key',
    (urlPrefix) => {
      expect(messageOf({ name: 'A', urlPrefix })).toContain('urlPrefix');
    },
  );
});

describe('docs.schema.json', () => {
  it('is in sync with the zod schema (run `pnpm schema` to update)', async () => {
    const { readFile } = await import('node:fs/promises');
    const file = new URL('../../docs.schema.json', import.meta.url);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(
      docsConfigJsonSchema(),
    );
  });
});

describe('parseConfig: search', () => {
  it('defaults to the built-in engine', () => {
    expect(parseConfig({ name: 'A' }).search).toEqual({
      backend: 'builtin',
      limit: 10,
    });
  });

  it('accepts a server route or a custom endpoint', () => {
    expect(
      parseConfig({
        name: 'A',
        search: { backend: 'custom', endpoint: 'https://s.example.com/q' },
      }).search.endpoint,
    ).toBe('https://s.example.com/q');
    expect(
      parseConfig({ name: 'A', search: { backend: 'server', limit: 5 } }).search
        .limit,
    ).toBe(5);
  });

  it('requires an endpoint for custom and rejects bad values', () => {
    expect(messageOf({ name: 'A', search: { backend: 'custom' } })).toContain(
      'search.endpoint: is required',
    );
    expect(messageOf({ name: 'A', search: { backend: 'algolia' } })).toContain(
      'search.backend',
    );
    expect(messageOf({ name: 'A', search: { endpoint: 'api/s' } })).toContain(
      'search.endpoint',
    );
    expect(messageOf({ name: 'A', search: { limit: 0 } })).toContain(
      'search.limit',
    );
  });
});

describe('parseConfig: ai', () => {
  it('is off by default and needs nothing', () => {
    const ai = parseConfig({ name: 'A' }).ai;
    expect(ai.enabled).toBe(false);
    expect(ai.limits.ratePerMinute).toBe(10);
  });

  it('accepts a provider, model, compatible server, embeddings and limits', () => {
    const ai = parseConfig({
      name: 'A',
      ai: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'http://localhost:11434/v1',
        embeddings: { model: 'text-embedding-3-small', dimensions: 512 },
        limits: { ratePerMinute: 3 },
      },
    }).ai;
    expect(ai.embeddings).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 512,
    });
    expect(ai.limits).toMatchObject({ ratePerMinute: 3, maxOutputTokens: 800 });
  });

  it('needs a provider and model once enabled, except a custom adapter needs no model', () => {
    expect(messageOf({ name: 'A', ai: { enabled: true } })).toContain(
      'ai.provider: is required',
    );
    expect(
      messageOf({ name: 'A', ai: { enabled: true, provider: 'anthropic' } }),
    ).toContain('ai.model: is required');
    expect(() =>
      parseConfig({ name: 'A', ai: { enabled: true, provider: 'custom' } }),
    ).not.toThrow();
  });

  it('never accepts a secret in docs.json, and says where it goes', () => {
    const message = messageOf({
      name: 'A',
      ai: { enabled: true, provider: 'openai', model: 'm', apiKey: 'sk-123' },
    });
    expect(message).toContain('unknown key ai.apiKey');
    expect(message).toContain('DOCKUDOS_LLM_API_KEY');
  });

  it('rejects bad values', () => {
    expect(messageOf({ name: 'A', ai: { provider: 'gemini' } })).toContain(
      'ai.provider',
    );
    expect(messageOf({ name: 'A', ai: { baseUrl: 'ftp://x' } })).toContain(
      'ai.baseUrl',
    );
    expect(
      messageOf({ name: 'A', ai: { limits: { ratePerMinute: 0 } } }),
    ).toContain('ai.limits.ratePerMinute');
  });
});
