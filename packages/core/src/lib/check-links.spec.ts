import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPages } from '../node.ts';
import { checkLinks, formatLinkProblems } from './check-links.ts';

let root: string;
let docs: string;
const put = async (file: string, text: string) => {
  await mkdir(join(docs, file, '..'), { recursive: true });
  await writeFile(join(docs, file), text);
};
const run = async (extra: Partial<Parameters<typeof checkLinks>[0]> = {}) =>
  checkLinks({
    docsDir: docs,
    publicDir: join(root, 'public'),
    tree: await discoverPages(docs),
    ...extra,
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-links-'));
  docs = join(root, 'docs');
  await mkdir(join(root, 'public'), { recursive: true });
  await writeFile(join(root, 'public', 'logo.svg'), '<svg/>');
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('checkLinks: internal', () => {
  it('passes valid page links, anchors, assets and same-page anchors', async () => {
    await put(
      'index.mdx',
      '# Home\n\n[a](./a.mdx#setup) [b](/guides/b) [here](#home) ![l](/logo.svg) ![r](./pic.png) [ext](https://x.dev)',
    );
    await put('a.mdx', '## Setup\n');
    await put('guides/b.mdx', 'B');
    await writeFile(join(docs, 'pic.png'), 'x');
    expect(await run()).toEqual([]);
  });

  it('reports a dead page with file and line', async () => {
    await put('index.mdx', 'one\n\ntwo [gone](./nope.mdx)\n');
    expect(await run()).toEqual([
      {
        file: 'index.mdx',
        line: 3,
        href: './nope.mdx',
        message: 'no page at /nope',
        severity: 'error',
      },
    ]);
  });

  it('reports a dead anchor on another page and on the same page', async () => {
    await put('index.mdx', '[x](./a.mdx#missing)\n\n# T\n[y](#also-missing)');
    await put('a.mdx', '## Present');
    const problems = await run();
    expect(problems.map((p) => [p.file, p.line, p.message])).toEqual([
      ['index.mdx', 1, '/a has no heading with id "missing"'],
      ['index.mdx', 4, 'no heading with id "also-missing" on this page'],
    ]);
  });

  it('sees headings that come from an include', async () => {
    await put('index.mdx', '[x](./a.mdx#from-partial)');
    await put('a.mdx', '<include>./_p.mdx</include>');
    await put('_p.mdx', '## From partial');
    expect(await run()).toEqual([]);
  });

  it('checks links inside partials too, naming the partial', async () => {
    await put('index.mdx', '<include>./_p.mdx</include>');
    await put('_p.mdx', '\n[bad](/nowhere)');
    expect((await run()).map((p) => [p.file, p.line])).toEqual([['_p.mdx', 2]]);
  });

  it('reports missing assets, in public and relative', async () => {
    await put('guides/index.mdx', '![a](/missing.png) ![b](./gone.png)');
    const problems = await run();
    expect(problems.map((p) => p.message)).toEqual([
      'file not found: /missing.png',
      'file not found: ./gone.png',
    ]);
  });

  it('accepts links to a redirected old URL', async () => {
    await put('index.mdx', '[old](/old-page)');
    expect(await run({ redirectSources: ['/old-page'] })).toEqual([]);
    expect(await run()).toHaveLength(1);
  });

  it('ignores links in code', async () => {
    await put('index.mdx', '```md\n[x](/nope)\n```\n\n`[y](/nope)`');
    expect(await run()).toEqual([]);
  });
});

describe('checkLinks: prefix', () => {
  it('resolves relative links under the mount point and absolute ones as written', async () => {
    await put('index.mdx', '[a](./a.mdx) [b](/docs/a) [c](/a)');
    await put('a.mdx', 'A');
    const tree = await discoverPages(docs, { prefix: '/docs' });
    const problems = await checkLinks({ docsDir: docs, tree, prefix: '/docs' });
    expect(problems.map((p) => [p.href, p.message])).toEqual([
      ['/a', 'no page at /a'],
    ]);
  });
});

describe('checkLinks: external', () => {
  const response = (status: number) => ({ status }) as Response;

  it('skips external links unless asked', async () => {
    await put('index.mdx', '[x](https://dead.example.com/a)');
    const fetch = vi.fn();
    expect(await run({ fetch: fetch as never })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails on 404 and 410, passes on 200 and redirects', async () => {
    await put(
      'index.mdx',
      '[a](https://x.dev/ok)\n[b](https://x.dev/dead)\n[c](https://x.dev/gone#frag)',
    );
    const fetch = vi.fn(async (url: string) =>
      response(url.endsWith('ok') ? 200 : url.endsWith('dead') ? 404 : 410),
    );
    const problems = await run({ external: true, fetch: fetch as never });
    expect(problems.map((p) => [p.line, p.severity, p.message])).toEqual([
      [2, 'error', 'external link is dead (HTTP 404)'],
      [3, 'error', 'external link is dead (HTTP 410)'],
    ]);
  });

  it('retries with GET when HEAD is not allowed', async () => {
    await put('index.mdx', '[a](https://x.dev/a)');
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(init?.method === 'HEAD' ? 405 : 200),
    );
    expect(await run({ external: true, fetch: fetch as never })).toEqual([]);
    expect(fetch.mock.calls.map((c) => (c[1] as RequestInit).method)).toEqual([
      'HEAD',
      'GET',
    ]);
  });

  it('turns a timeout or network failure into a warning, not an error', async () => {
    await put('index.mdx', '[a](https://slow.dev)\n[b](https://down.dev)');
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('slow'))
        throw Object.assign(new Error('The operation timed out'), {
          name: 'TimeoutError',
        });
      throw new Error('getaddrinfo ENOTFOUND down.dev');
    });
    const problems = await run({
      external: true,
      fetch: fetch as never,
      timeout: 50,
    });
    expect(problems.map((p) => [p.severity, p.message])).toEqual([
      ['warning', 'no response within 50 ms'],
      ['warning', 'could not reach host (getaddrinfo ENOTFOUND down.dev)'],
    ]);
  });

  it('treats 403, 429 and 5xx as unverifiable warnings', async () => {
    await put('index.mdx', '[a](https://x.dev/a)\n[b](https://x.dev/b)');
    const fetch = vi.fn(async (url: string) =>
      response(url.endsWith('a') ? 429 : 503),
    );
    const problems = await run({ external: true, fetch: fetch as never });
    expect(problems.every((p) => p.severity === 'warning')).toBe(true);
  });

  it('requests each URL once even when linked many times', async () => {
    await put(
      'index.mdx',
      '[a](https://x.dev/a) [b](https://x.dev/a#one) [c](https://x.dev/a#two)',
    );
    const fetch = vi.fn(async () => response(200));
    await run({ external: true, fetch: fetch as never });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('formatLinkProblems', () => {
  it('lists errors before warnings with file:line', () => {
    const text = formatLinkProblems([
      {
        file: 'b.mdx',
        line: 2,
        href: 'https://x.dev',
        message: 'slow',
        severity: 'warning',
      },
      {
        file: 'a.mdx',
        line: 9,
        href: '/x',
        message: 'no page at /x',
        severity: 'error',
      },
    ]);
    expect(text).toBe(
      'error   a.mdx:9  /x  no page at /x\nwarning b.mdx:2  https://x.dev  slow',
    );
  });
});
