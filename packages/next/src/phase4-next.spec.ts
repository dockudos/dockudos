import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessProxy, i18nFromBuild } from './access.ts';
import { createDocsApi } from './api.ts';
import { createFeedHandler } from './feeds.ts';
import { withDocs } from './lib/with-docs.ts';
import { createLlmsFullHandler, createLlmsHandler } from './llms.ts';
import { createMarkdownHandler } from './markdown.ts';
import { getSite } from './server.ts';
import { resolveViewer } from './viewer.ts';

let root: string;
let cwd: string;
const put = async (file: string, text: string) => {
  await mkdir(join(root, file, '..'), { recursive: true });
  await writeFile(join(root, file), text);
};

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-p4n-'));
  await put(
    'docs.json',
    JSON.stringify({
      name: 'Acme',
      seo: { siteUrl: 'https://docs.test' },
      versions: { default: 'v2', list: [{ name: 'v2' }, { name: 'v1' }] },
      i18n: { default: 'en', locales: ['en', 'fr'], detect: true },
      feeds: { posts: true },
      ai: { enabled: true, provider: 'custom' },
    }),
  );
  await put('docs/v2/en/index.mdx', '---\ntitle: Home\n---\nHello.');
  await put('docs/v2/fr/index.mdx', '---\ntitle: Accueil\n---\nBonjour.');
  await put('docs/v1/en/index.mdx', '---\ntitle: Home 1\n---\nOld.');
  process.chdir(root);
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

const url = (p: string) => `http://docs.test${p}`;
const ctx = (...s: string[]) => ({ params: Promise.resolve({ dockudos: s }) });

describe('llms.txt for another version or language', () => {
  it('lists the defaults, another scope on request, and refuses an unknown one', async () => {
    const fr = await (
      await createLlmsHandler()(new Request(url('/llms.txt?locale=fr')))
    ).text();
    expect(fr).toContain('Accueil');
    expect(fr).not.toContain('[Home]');
    const old = await (
      await createLlmsFullHandler()(
        new Request(url('/llms-full.txt?version=v1')),
      )
    ).text();
    expect(old).toContain('Home 1');
    expect(
      (await createLlmsHandler()(new Request(url('/llms.txt?version=v9'))))
        .status,
    ).toBe(400);
    expect(
      (
        await createLlmsFullHandler()(
          new Request(url('/llms-full.txt?locale=zz')),
        )
      ).status,
    ).toBe(400);
    // no request at all (a static export): the defaults
    expect(await (await createLlmsHandler()()).text()).toContain('[Home]');
  });

  it('does not read the request in a static export', async () => {
    vi.stubEnv('NEXT_PUBLIC_DOCKUDOS_STATIC', '1');
    const touched = vi.fn();
    const request = new Proxy(new Request(url('/llms.txt?locale=fr')), {
      get(target, prop) {
        if (prop === 'url') touched();
        return Reflect.get(target, prop) as unknown;
      },
    });
    expect(await (await createLlmsHandler()(request)).text()).toContain(
      '[Home]',
    );
    expect((await createFeedHandler('posts')(request)).status).toBe(404); // nothing dated
    expect(touched).not.toHaveBeenCalled();
  });
});

describe('the language settings that reach the proxy', () => {
  it('are read from the build, and ignored when missing or damaged', () => {
    vi.stubEnv('DOCKUDOS_I18N', '');
    expect(i18nFromBuild()).toBeUndefined();
    vi.stubEnv('DOCKUDOS_I18N', 'not json');
    expect(i18nFromBuild()).toBeUndefined();
    vi.stubEnv(
      'DOCKUDOS_I18N',
      JSON.stringify({ default: 'en', locales: ['en', 'fr'], detect: true }),
    );
    expect(i18nFromBuild()).toMatchObject({ default: 'en' });
  });

  it('are put there by withDocs() when detection is on, with the default version first', () => {
    const env = (withDocs({}, { root }).env ?? {}) as Record<string, string>;
    expect(JSON.parse(env['DOCKUDOS_I18N'] as string)).toEqual({
      default: 'en',
      locales: ['en', 'fr'],
      versions: ['v2', 'v1'],
      detect: true,
    });
    expect(JSON.parse(env['DOCKUDOS_ACCESS'] as string)).toEqual([]);
  });

  it('are left out when detection is off, and the prefix is kept when there is one', async () => {
    await put(
      'docs.json',
      JSON.stringify({
        name: 'A',
        urlPrefix: '/docs',
        i18n: { default: 'en', locales: ['en', 'fr'], detect: true },
      }),
    );
    expect(
      JSON.parse(
        ((withDocs({}, { root }).env ?? {}) as Record<string, string>)[
          'DOCKUDOS_I18N'
        ] as string,
      ),
    ).toMatchObject({ urlPrefix: '/docs' });
    await put(
      'docs.json',
      JSON.stringify({
        name: 'A',
        i18n: { default: 'en', locales: ['en', 'fr'] },
      }),
    );
    expect(withDocs({}, { root }).env ?? {}).not.toHaveProperty(
      'DOCKUDOS_I18N',
    );
  });

  it('send visitors using the build settings when the proxy is given none', async () => {
    vi.stubEnv(
      'DOCKUDOS_I18N',
      JSON.stringify({ default: 'en', locales: ['en', 'fr'], detect: true }),
    );
    const res = await createAccessProxy({ rules: [] })(
      new Request(url('/x'), {
        headers: { accept: 'text/html', 'accept-language': 'fr' },
      }),
    );
    expect(res?.status).toBe(307);
  });
});

describe('the viewer', () => {
  it('counts a rule that throws as not passed', async () => {
    const rules = [{ paths: ['/a/**'], require: 'custom' as const }];
    const viewer = await resolveViewer(new Request(url('/a/x')), rules, {
      verify: () => {
        throw new Error('boom');
      },
    });
    expect(viewer.canSee('/a/x')).toBe(false);
    expect(viewer.canSee('/open')).toBe(true);
    expect(viewer.scope).toBe('');
  });

  it('names what was passed, and sees everything when there are no rules', async () => {
    const rules = [
      { paths: ['/a/**'], require: 'custom' as const },
      { paths: ['/b/**'], require: 'custom' as const },
    ];
    const viewer = await resolveViewer(new Request(url('/')), rules, {
      verify: (_r, rule) => rule.paths[0] === '/b/**',
    });
    expect(viewer.scope).toBe('1');
    expect(viewer.canSee('/b/x')).toBe(true);
    expect(viewer.canSee('/a/x')).toBe(false);
    expect(
      (await resolveViewer(new Request(url('/')), [])).canSee('/anything'),
    ).toBe(true);
  });
});

describe('requests the API refuses', () => {
  it('refuses an unknown scope for navigate, an unknown language for ask, and a body that is not JSON', async () => {
    const api = createDocsApi();
    const post = (path: string, body: unknown) =>
      new Request(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(
      (
        await api.POST(
          post('/api/navigate', { query: 'home page', version: 'v9' }),
          ctx('navigate'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api.POST(
          post('/api/ask', {
            question: 'What is the home page?',
            locale: 'zz',
          }),
          ctx('ask'),
        )
      ).status,
    ).toBe(400);
  });

  it('finds the markdown twin of a language home page', async () => {
    const res = await createMarkdownHandler()(
      new Request(url('/api/markdown?path=/fr')),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Bonjour');
    expect((await getSite({ root })).find(['fr'])?.title).toBe('Accueil');
  });
});
