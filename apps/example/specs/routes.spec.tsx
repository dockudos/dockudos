import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as catchAll from '../src/app/[[...slug]]/page';
import * as embed from '../src/app/embed/page';
import * as print from '../src/app/print/page';

/**
 * The decisions the route files of a docs site make: which address redirects, which is a 404, what the assistant page
 * hands to the assistant. What the pages render is covered by the browser tests. The same three files also live in the
 * docs app and in the template `dockudos init` copies; the last block fails when they stop being the same code.
 */
const site = {
  config: {
    name: 'Acme',
    ai: {
      enabled: true,
      endpoint: '/api/ask',
      limits: { maxQuestionLength: 500 },
    },
  },
  find: vi.fn(),
  redirectFor: vi.fn(),
};
vi.mock('@dockudos/next/server', () => ({
  getSite: async () => site,
  staticParams: (s: unknown) => [{ slug: ['from', typeof s] }],
  pageMetadata: (_s: unknown, p: { title: string }) => ({ title: p.title }),
  bookRequest: async () => ({ scope: {}, under: undefined, nav: [] }),
}));
vi.mock('@dockudos/ui', () => ({
  DocsLayout: () => null,
  DocsBook: () => null,
  EmbeddedAssistant: () => null,
}));

const slug = (...s: string[]) => ({ params: Promise.resolve({ slug: s }) });
/** Next signals a redirect and a 404 by throwing; the digest says which. */
const digestOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
  return undefined;
};

beforeEach(() => {
  site.find.mockReset();
  site.redirectFor.mockReset();
  site.config.ai.enabled = true;
});

describe('the catch-all page', () => {
  it('builds a page for every address the site has', async () => {
    expect(await catchAll.generateStaticParams()).toEqual([
      { slug: ['from', 'object'] },
    ]);
  });

  it('titles a page from the site, and gives an unknown address no metadata', async () => {
    site.find.mockReturnValueOnce({ title: 'Auth' });
    expect(await catchAll.generateMetadata(slug('auth'))).toEqual({
      title: 'Auth',
    });
    site.find.mockReturnValueOnce(undefined);
    expect(await catchAll.generateMetadata(slug('nope'))).toEqual({});
  });

  it('sends the reader of /v2/... or /en/... to the short address instead of a 404', async () => {
    site.find.mockReturnValue(undefined);
    site.redirectFor.mockReturnValue('/guides/auth');
    const digest = await digestOf(
      catchAll.default(slug('v2', 'guides', 'auth')),
    );
    expect(digest).toMatch(/^NEXT_REDIRECT;replace;\/guides\/auth;/);
    expect(site.redirectFor).toHaveBeenCalledWith(['v2', 'guides', 'auth']);
  });

  it('answers 404 with neither a page nor a short address, for the home address too', async () => {
    site.find.mockReturnValue(undefined);
    site.redirectFor.mockReturnValue(undefined);
    expect(await digestOf(catchAll.default(slug('nope')))).toBe(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(
      await digestOf(catchAll.default({ params: Promise.resolve({}) })),
    ).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(site.redirectFor).toHaveBeenLastCalledWith([]);
  });
});

describe('the book (/print)', () => {
  it('is titled after the site, and kept out of search engines', async () => {
    const meta = await print.generateMetadata();
    expect(meta.title).toEqual({ absolute: 'Acme documentation' });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('the embedded assistant (/embed)', () => {
  it('is not indexed', () => {
    expect(embed.metadata.robots).toEqual({ index: false, follow: false });
    expect(embed.metadata.title).toBe('Ask the docs');
  });

  it('does not exist when the assistant is switched off', async () => {
    site.config.ai.enabled = false;
    expect(
      await digestOf(embed.default({ searchParams: Promise.resolve({}) })),
    ).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it("hands the site's endpoint and limits, and the host page's context, to the assistant", async () => {
    const el = (await embed.default({
      searchParams: Promise.resolve({ path: '/guides/auth', hint: 'login' }),
    })) as { props: Record<string, unknown> };
    expect(el.props).toMatchObject({
      name: 'Acme',
      endpoint: '/api/ask',
      maxQuestionLength: 500,
      context: { path: '/guides/auth', hint: 'login' },
    });
  });

  it('passes no context when the host page sent none, or sent something that is not a plain string', async () => {
    const none = (await embed.default({
      searchParams: Promise.resolve({}),
    })) as { props: { context?: unknown } };
    expect(none.props.context).toBeUndefined();
    const junk = (await embed.default({
      searchParams: Promise.resolve({ path: 'javascript:alert(1)' }),
    })) as { props: { context?: unknown } };
    expect(JSON.stringify(junk.props.context ?? {})).not.toContain(
      'javascript',
    );
  });
});

describe('the copies of these routes stay the same code', () => {
  const root = join(import.meta.dirname, '../../..');
  const squash = (file: string) =>
    readFileSync(join(root, file), 'utf8').replace(/[\s;]+/g, '');
  const routes = ['[[...slug]]/page.tsx', 'print/page.tsx', 'embed/page.tsx'];

  it.each(routes)(
    'apps/docs and the init template match the example for %s',
    (route) => {
      const original = squash(`apps/example/src/app/${route}`);
      expect(squash(`apps/docs/src/app/${route}`)).toBe(original);
      expect(squash(`packages/cli/templates/default/src/app/${route}`)).toBe(
        original,
      );
    },
  );
});
