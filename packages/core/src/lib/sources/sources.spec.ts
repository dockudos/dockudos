import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../config.ts';
import {
  type ConfiguredSource,
  createHtmlSource,
  createLocalSource,
  createVaultSource,
  sourcesFromConfig,
  syncSource,
} from '../sources-node.ts';
import { assertFetchable, getBytes, getJson, isPrivateHost } from './http.ts';
import { htmlToMarkdown } from './html.ts';
import { blockToMarkdown, createNotionSource } from './notion.ts';
import { convertVault, notePath } from './obsidian.ts';
import { createRemoteSource } from './remote.ts';
import { createSanitySource, portableTextToMarkdown } from './sanity.ts';
import {
  type ContentSource,
  SourceError,
  assertSourceFiles,
  frontmatter,
  isPageFile,
  isSafePath,
  mdxSafe,
  normalizeDate,
  slugSegment,
} from './types.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-src-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));
const put = async (file: string, text: string | Uint8Array) => {
  await mkdir(join(dir, file, '..'), { recursive: true });
  await writeFile(join(dir, file), text);
};

/** A fetch that answers from a table of URL to body (objects are JSON), and records what it was asked. */
function fakeFetch(
  table: Record<string, unknown>,
  calls: { url: string; headers: Headers }[] = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const body = table[url];
    if (body === undefined) return new Response('no', { status: 404 });
    if (body instanceof Response) return body;
    return new Response(
      typeof body === 'string' || body instanceof Uint8Array
        ? body
        : JSON.stringify(body),
      {
        headers: {
          'content-type':
            typeof body === 'string' ? 'text/plain' : 'application/json',
        },
      },
    );
  }) as typeof fetch;
}

describe('helpers', () => {
  it('recognizes safe paths', () => {
    for (const p of ['a.md', 'guides/a.mdx', 'a b/c.md'] as const)
      expect(isSafePath(p)).toBe(true);
    for (const p of [
      '',
      '/a.md',
      '../a.md',
      'a/../b.md',
      'a//b.md',
      'a\\b.md',
      '.hidden/a.md',
      'a/./b.md',
      'a:b.md',
      'a\0b.md',
      'x'.repeat(301),
    ])
      expect(isSafePath(p)).toBe(false);
    expect(isPageFile('A.MDX')).toBe(true);
    expect(isPageFile('a.png')).toBe(false);
  });

  it('checks the contract and says which file breaks it', () => {
    expect(() =>
      assertSourceFiles([
        { path: 'a.md', content: '' },
        { path: 'b.md', content: '' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertSourceFiles([{ path: '../a.md', content: '' }], 's'),
    ).toThrow(/s: "..\/a.md" is not a safe/);
    expect(() =>
      assertSourceFiles([
        { path: 'a.md', content: '' },
        { path: 'A.md', content: '' },
      ]),
    ).toThrow(/twice/);
    expect(() =>
      assertSourceFiles([
        { path: 'b.md', content: '' },
        { path: 'a.md', content: '' },
      ]),
    ).toThrow(/path order/);
    expect(() =>
      assertSourceFiles([{ path: 'a.md', content: new Uint8Array() }]),
    ).toThrow(/not text/);
    expect(() =>
      assertSourceFiles([{ path: 'a.png', content: new Uint8Array() }]),
    ).not.toThrow();
  });

  it('writes frontmatter only with valid values', () => {
    expect(
      frontmatter({
        title: 'A "quote"',
        description: ' d ',
        date: '2026-03-31T10:00:00Z',
        tags: ['a', ' ', 'b'],
      }),
    ).toBe(
      '---\ntitle: "A \\"quote\\""\ndescription: "d"\ndate: 2026-03-31\ntags: ["a", "b"]\n---\n\n',
    );
    expect(frontmatter({ date: 'yesterday' })).toBe('');
    expect(normalizeDate('2026-02-30')).toBeUndefined();
    expect(normalizeDate(undefined)).toBeUndefined();
    expect(slugSegment('Ça va? Très bien!')).toBe('ca-va-tres-bien');
    expect(slugSegment('???')).toBe('page');
  });

  it('makes Markdown safe for MDX without touching code', () => {
    const out = mdxSafe(
      'Use {x} and <b> here.\r\nAn `{inline}` and <https://x.io>.\n```js\nconst a = {b: <c/>};\n```\nimport x from "y"',
    );
    expect(out).toContain('Use \\{x\\} and &lt;b> here.');
    expect(out).toContain('`{inline}`');
    expect(out).toContain('&lt;https://x.io>');
    expect(out).toContain('const a = {b: <c/>};');
    expect(mdxSafe('already \\{escaped\\}')).toBe('already \\{escaped\\}');
    expect(out).toContain('&#105;mport x from "y"');
    expect(mdxSafe('  export const a = 1')).toBe('  &#101;xport const a = 1');
    expect(mdxSafe('an import in the middle')).toBe('an import in the middle');
    expect(
      mdxSafe(
        '[a](javascript:alert(1)) ![b](DATA:text/html,x) [c](https://ok.io)',
      ),
    ).toBe('[a](#) ![b](#) [c](https://ok.io)');
  });
});

describe('http', () => {
  it('allows https and localhost only', () => {
    expect(assertFetchable('https://x.io/a', 's').host).toBe('x.io');
    expect(assertFetchable('http://localhost:3000/a', 's').port).toBe('3000');
    expect(() => assertFetchable('http://x.io', 's')).toThrow(/https/);
    expect(() => assertFetchable('file:///etc/passwd', 's')).toThrow(/https/);
    expect(() => assertFetchable('nope', 's')).toThrow(/not a URL/);
  });

  it('caps size, reports status, parses JSON and retries when asked to slow down', async () => {
    const f = fakeFetch({
      'https://x.io/big': 'x'.repeat(100),
      'https://x.io/json': { a: 1 },
      'https://x.io/text': 'not json',
    });
    await expect(
      getBytes('https://x.io/big', 's', { fetch: f, maxBytes: 10 }),
    ).rejects.toThrow(/larger than 10/);
    await expect(
      getBytes('https://x.io/missing', 's', { fetch: f }),
    ).rejects.toThrow(/answered 404/);
    await expect(
      getJson('https://x.io/json', 's', { fetch: f }),
    ).resolves.toEqual({ a: 1 });
    await expect(
      getJson('https://x.io/text', 's', { fetch: f }),
    ).rejects.toThrow(/did not answer JSON/);
    let n = 0;
    const slow = (async () =>
      ++n < 3
        ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
        : new Response('ok')) as typeof fetch;
    expect(
      new TextDecoder().decode(
        await getBytes('https://x.io/a', 's', { fetch: slow }),
      ),
    ).toBe('ok');
    expect(n).toBe(3);
    const stuck = (async () =>
      new Response('', {
        status: 429,
        headers: { 'retry-after': '0' },
      })) as typeof fetch;
    await expect(
      getBytes('https://x.io/a', 's', { fetch: stuck }),
    ).rejects.toThrow(/429/);
  });
});

describe('Obsidian', () => {
  const vault = [
    {
      path: 'Home.md',
      content:
        '---\ntitle: Start\ntags: [a, b]\ndate: 2026-01-02\nowner: me\n---\nSee [[Guides/Getting Started|the guide]] and [[getting started#Install]] and [[Missing]].\n\n![[Attachments/Pic One.png]] ![[gone.png]]\n\n%% hidden %%==marked==',
    },
    {
      path: 'Guides/Getting Started.md',
      content:
        '# Getting started\n\n> [!tip] Remember\n> Use {braces} and <tags>.\n\n> plain quote\n\n## Install\n\n[[Home]]',
    },
    {
      path: 'Guides/getting-started.md',
      content: 'A note whose name slugs the same.',
    },
    { path: 'Attachments/Pic One.png', content: new Uint8Array([1, 2, 3]) },
    { path: 'notes.txt', content: 'ignored' },
    { path: '../evil.md', content: 'x' },
  ];
  const out = convertVault(vault);
  const byPath = Object.fromEntries(out.map((f) => [f.path, f.content]));

  it('writes sorted, safe, unique files, and renames notes that slug alike', () => {
    expect(() => assertSourceFiles(out)).not.toThrow();
    expect(out.map((f) => f.path)).toEqual([
      'attachments/pic-one.png',
      'guides/getting-started-2.md',
      'guides/getting-started.md',
      'home.md',
    ]);
    expect(notePath('A B/C d')).toBe('a-b/c-d');
  });

  it('keeps known frontmatter only, and links notes, headings and images', () => {
    const home = byPath['home.md'] as string;
    expect(
      home.startsWith(
        '---\ntitle: "Start"\ndate: 2026-01-02\ntags: ["a", "b"]\n---\n',
      ),
    ).toBe(true);
    expect(home).not.toContain('owner');
    expect(home).toContain(
      '[the guide](guides/getting-started.md)'.replace('.md', ''),
    );
    expect(home).toContain('[getting started](guides/getting-started#install)');
    expect(home).toContain('Missing'); // text, no link
    expect(home).not.toContain('[Missing]');
    expect(home).toContain('![Pic One](attachments/pic-one.png)');
    expect(home).not.toContain('gone');
    expect(home).not.toContain('hidden');
    expect(home).toContain('marked');
    expect(home).not.toContain('==');
    expect(byPath['attachments/pic-one.png']).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('turns callouts into admonitions and makes the text MDX-safe', () => {
    const guide = byPath['guides/getting-started.md'] as string;
    expect(guide).toContain(
      ':::tip[Remember]\nUse \\{braces} and &lt;tags>.'
        .replace('\\{braces}', '\\{braces\\}')
        .replace('&lt;tags>.', '&lt;tags>.'),
    );
    expect(guide).toContain('> plain quote');
    expect(guide).toContain('[Home](../home)');
    expect(guide).toContain('title: "Getting started"');
  });
});

describe('HTML', () => {
  const page = `<!doctype html><html><head><title>Hello &amp; welcome</title><meta name="description" content="A page"><script>alert(1)</script></head>
<body><nav><a href="/">Home</a></nav><main><h1>Hello</h1><p>Some <strong>bold</strong>, <em>soft</em> and <code>code</code> with a <a href="https://x.io/a(b)">link</a>
and <a href="javascript:alert(1)">bad</a>.<br>Next line</p>
<ul><li>One<li>Two <ul><li>Nested</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>
<blockquote><p>Quoted</p></blockquote><pre>line 1
line 2 &lt;tag&gt;</pre><hr><img src="/p.png" alt="Pic [x]"><img src="data:text/html,x" alt="no">
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>a|b</td></tr><tr><td>2</td></tr></table><div>{not code} <i>x</i></div></main><footer>Foot</footer></body></html>`;

  it('extracts title, description and readable Markdown', () => {
    const { title, description, body } = htmlToMarkdown(page);
    expect(title).toBe('Hello & welcome');
    expect(description).toBe('A page');
    expect(body).toContain('# Hello');
    expect(body).toContain(
      'Some **bold**, *soft* and `code` with a [link](https://x.io/a%28b%29)',
    );
    expect(body).toContain('and bad.');
    expect(body).toContain('- One\n- Two');
    expect(body).toContain('  - Nested');
    expect(body).toContain('1. First\n2. Second');
    expect(body).toContain('> Quoted');
    expect(body).toContain('```\nline 1\nline 2 <tag>\n```');
    expect(body).toContain('---');
    expect(body).toContain('![Pic x](/p.png)');
    expect(body).not.toContain('data:');
    expect(body).toContain('| A | B |\n| --- | --- |\n| 1 | a\\|b |\n| 2 |  |');
    expect(body).not.toMatch(/alert|Foot|Home/);
  });

  it('treats a fragment, entities and unclosed tags sensibly', () => {
    expect(
      htmlToMarkdown('<p>One<p>Two &#169; &copy; &#x41; &bogus;').body,
    ).toBe('One\n\nTwo © © A &bogus;');
    expect(htmlToMarkdown('').body).toBe('');
    expect(htmlToMarkdown('<h2></h2><p> </p>').body).toBe('');
  });

  it('is a source over a folder', async () => {
    await put('index.html', page);
    await put('docs/guide.htm', '<h1>Guide</h1><p>Text {x}</p>');
    await put('skip.txt', 'no');
    const files = await createHtmlSource({ name: 'site', dir }).read();
    expect(files.map((f) => f.path)).toEqual(['docs/guide.md', 'index.md']);
    expect(files[0]?.content).toContain('title: "Guide"');
    expect(files[0]?.content).toContain('Text \\{x\\}');
  });
});

describe('remote', () => {
  const list = [
    { path: 'b/two.mdx', url: 'https://cdn.x.io/two.mdx' },
    { path: 'one.md', url: '/one.md' },
    { path: 'img.png', url: 'https://other.io/img.png' },
  ];
  const table = {
    'https://docs.x.io/list.json': { files: list },
    'https://cdn.x.io/two.mdx': 'import X from "x"\n\n<X a={1} />\n',
    'https://docs.x.io/one.md': '# One {x}',
    'https://other.io/img.png': new Uint8Array([9]),
  };

  it('reads the list, escapes pages unless told they are MDX, and sends the token only to the listing host', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const source = createRemoteSource({
      name: 'r',
      url: 'https://docs.x.io/list.json',
      token: 'sekret',
      fetch: fakeFetch(table, calls),
    });
    const files = await source.read();
    expect(files.map((f) => f.path)).toEqual(['b/two.md', 'img.png', 'one.md']);
    expect(files[0]?.content).toContain('&lt;X a=');
    expect(files[2]?.content).toBe('# One \\{x\\}');
    const auth = Object.fromEntries(
      calls.map((c) => [c.url, c.headers.get('authorization')]),
    );
    expect(auth['https://docs.x.io/list.json']).toBe('Bearer sekret');
    expect(auth['https://docs.x.io/one.md']).toBe('Bearer sekret');
    expect(auth['https://cdn.x.io/two.mdx']).toBeNull();
    expect(auth['https://other.io/img.png']).toBeNull();
  });

  it('keeps MDX as it is when told to', async () => {
    const files = await createRemoteSource({
      name: 'r',
      url: 'https://docs.x.io/list.json',
      mdx: true,
      fetch: fakeFetch(table),
    }).read();
    expect(files[0]).toMatchObject({ path: 'b/two.mdx' });
    expect(files[0]?.content).toContain('<X a={1} />');
  });

  it('does not let a list point at private networks', async () => {
    for (const host of [
      '169.254.169.254',
      '10.0.0.5',
      '192.168.1.1',
      '172.20.0.1',
      '127.0.0.1',
      '[::1]',
      'localhost',
      'db.internal',
      '[fd00::1]',
      '100.64.0.1',
    ]) {
      const f = fakeFetch({
        'https://docs.x.io/l': [{ path: 'a.md', url: `https://${host}/a` }],
      });
      await expect(
        createRemoteSource({
          name: 'r',
          url: 'https://docs.x.io/l',
          fetch: f,
        }).read(),
      ).rejects.toThrow(/private address/);
    }
    for (const host of [
      'docs.x.io',
      'cdn.example.com',
      '8.8.8.8',
      '172.32.0.1',
      '[2001:db8::1]',
    ])
      expect(isPrivateHost(host)).toBe(false);
    expect(isPrivateHost('0.0.0.0')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
    // a list on the same host may name that host, even a private one
    const local = fakeFetch({
      'http://localhost:9000/l': [{ path: 'a.md', url: '/a.md' }],
      'http://localhost:9000/a.md': 'A',
    });
    await expect(
      createRemoteSource({
        name: 'r',
        url: 'http://localhost:9000/l',
        fetch: local,
      }).read(),
    ).resolves.toHaveLength(1);
  });

  it('refuses a bad list, an unsafe path, a long list and a plain-http address', async () => {
    const run = (value: unknown, extra = {}) =>
      createRemoteSource({
        name: 'r',
        url: 'https://docs.x.io/l',
        fetch: fakeFetch({ 'https://docs.x.io/l': value }),
        ...extra,
      }).read();
    await expect(run({ nope: 1 })).rejects.toThrow(/must answer a list/);
    await expect(
      run([{ path: '../x.md', url: 'https://x.io/x' }]),
    ).rejects.toThrow(/unsafe path/);
    await expect(run([{ path: 'a.md' }])).rejects.toThrow(/unsafe path/);
    await expect(run([null])).rejects.toThrow(/unsafe path/);
    await expect(
      run(
        [
          { path: 'a.md', url: 'https://x.io/a' },
          { path: 'b.md', url: 'https://x.io/b' },
        ],
        { limit: 1 },
      ),
    ).rejects.toThrow(/more than the limit/);
    await expect(
      createRemoteSource({ name: 'r', url: 'http://docs.x.io/l' }).read(),
    ).rejects.toThrow(/https/);
  });
});

describe('Sanity', () => {
  const query = '*[_type=="doc"]';
  const url = `https://abc123.api.sanity.io/v2021-06-07/data/query/production?query=${encodeURIComponent(query)}`;
  const result = [
    {
      title: 'Portable',
      slug: { current: 'guides/portable' },
      date: '2026-05-01T10:00:00Z',
      body: [
        {
          _type: 'block',
          style: 'h2',
          children: [{ _type: 'span', text: 'Heading' }],
        },
        {
          _type: 'block',
          children: [
            { text: 'Plain ' },
            { text: 'bold', marks: ['strong'] },
            { text: ' ', marks: [] },
            { text: 'link', marks: ['l1', 'em'] },
            { text: ' [x]' },
          ],
          markDefs: [{ _key: 'l1', _type: 'link', href: 'https://x.io/a b' }],
        },
        {
          _type: 'block',
          listItem: 'bullet',
          level: 1,
          children: [{ text: 'one' }],
        },
        {
          _type: 'block',
          listItem: 'bullet',
          level: 2,
          children: [{ text: 'deep' }],
        },
        {
          _type: 'block',
          listItem: 'number',
          level: 1,
          children: [{ text: 'first' }],
        },
        {
          _type: 'block',
          listItem: 'number',
          level: 1,
          children: [{ text: 'second' }],
        },
        { _type: 'block', style: 'blockquote', children: [{ text: 'quote' }] },
        { _type: 'block', children: [{ text: '' }] },
        { _type: 'code', language: 'js', code: 'a()' },
        {
          _type: 'image',
          alt: 'Alt',
          asset: { url: 'https://cdn.sanity.io/i.png' },
        },
        { _type: 'image', asset: { url: 'javascript:x' } },
      ],
    },
    { title: 'Markdown', slug: 'md-doc', description: 'D', body: 'Text {x}' },
    { title: 'Twin', slug: 'md-doc', body: 'Same slug' },
    { title: 'No slug', body: 'x' },
    { title: 'No body', slug: 'nb' },
  ];

  it('turns documents into pages, portable text included', async () => {
    const files = await createSanitySource({
      name: 's',
      projectId: 'abc123',
      dataset: 'production',
      query,
      token: 't',
      fetch: fakeFetch({ [url]: { result } }),
    }).read();
    expect(files.map((f) => f.path)).toEqual([
      'guides/portable.md',
      'md-doc-2.md',
      'md-doc.md',
    ]);
    const portable = files[0]?.content as string;
    expect(portable).toContain('date: 2026-05-01');
    expect(portable).toContain('## Heading');
    expect(portable).toContain(
      'Plain **bold** *[link](https://x.io/a%20b)* \\[x\\]',
    );
    expect(portable).toContain('- one\n  - deep');
    expect(portable).toContain('1. first\n2. second');
    expect(portable).toContain('> quote');
    expect(portable).toContain('```js\na()\n```');
    expect(portable).toContain('![Alt](https://cdn.sanity.io/i.png)');
    expect(portable).not.toContain('javascript');
    expect(files[2]?.content).toContain('Text \\{x\\}');
    expect(files[2]?.content).toContain('description: "D"');
  });

  it('refuses odd project names and answers that are not lists', async () => {
    await expect(
      createSanitySource({
        name: 's',
        projectId: 'a/b',
        dataset: 'x',
        query,
      }).read(),
    ).rejects.toThrow(/characters Sanity does not allow/);
    await expect(
      createSanitySource({
        name: 's',
        projectId: 'abc123',
        dataset: 'production',
        query,
        fetch: fakeFetch({ [url]: { result: 5 } }),
      }).read(),
    ).rejects.toThrow(/list of documents/);
    expect(portableTextToMarkdown([])).toBe('');
  });
});

describe('Notion', () => {
  const rt = (text: string, extra: object = {}) => ({
    plain_text: text,
    ...extra,
  });
  const root = 'a'.repeat(32);
  const sub1 = 'b'.repeat(32);
  const sub2 = 'c'.repeat(32);
  const api = 'https://api.notion.com/v1';
  const table = {
    [`${api}/pages/${root}`]: {
      properties: { Name: { type: 'title', title: [rt('Handbook')] } },
    },
    [`${api}/blocks/${root}/children?page_size=100`]: {
      results: [
        {
          id: 'p1',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              rt('Hello '),
              rt('bold', { annotations: { bold: true } }),
              rt(' link', { href: 'https://x.io' }),
            ],
          },
        },
        { id: 'h', type: 'heading_2', heading_2: { rich_text: [rt('Part')] } },
        {
          id: 'l1',
          type: 'bulleted_list_item',
          has_children: true,
          bulleted_list_item: { rich_text: [rt('item')] },
        },
        {
          id: 'n1',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: [rt('one')] },
        },
        {
          id: 'n2',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: [rt('two')] },
        },
        {
          id: 'td',
          type: 'to_do',
          to_do: { rich_text: [rt('task')], checked: true },
        },
        {
          id: 'c',
          type: 'code',
          code: { language: 'ts', rich_text: [rt('let a = {};')] },
        },
        { id: 'q', type: 'quote', quote: { rich_text: [rt('wise')] } },
        { id: 'co', type: 'callout', callout: { rich_text: [rt('careful')] } },
        { id: 'tg', type: 'toggle', toggle: { rich_text: [rt('More')] } },
        { id: 'dv', type: 'divider', divider: {} },
        {
          id: 'im',
          type: 'image',
          image: {
            type: 'external',
            external: { url: 'https://x.io/i.png' },
            caption: [rt('cap')],
          },
        },
        {
          id: 'im2',
          type: 'image',
          image: { type: 'file', file: { url: 'http://insecure/i.png' } },
        },
        { id: 'bm', type: 'bookmark', bookmark: { url: 'https://x.io/bm' } },
        { id: 'un', type: 'unsupported' },
        {
          id: sub1,
          type: 'child_page',
          child_page: { title: 'Getting Started' },
        },
        {
          id: sub2,
          type: 'child_page',
          child_page: { title: 'Getting started' },
        },
      ],
      has_more: true,
      next_cursor: 'cur',
    },
    [`${api}/blocks/${root}/children?page_size=100&start_cursor=cur`]: {
      results: [],
      has_more: false,
    },
    [`${api}/blocks/l1/children?page_size=100`]: {
      results: [
        {
          id: 'l2',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [rt('sub item')] },
        },
      ],
    },
    [`${api}/blocks/${sub1}/children?page_size=100`]: {
      results: [
        { id: 'x', type: 'paragraph', paragraph: { rich_text: [rt('Leaf')] } },
      ],
    },
    [`${api}/blocks/${sub2}/children?page_size=100`]: {
      results: [
        { id: 'y', type: 'paragraph', paragraph: { rich_text: [rt('Other')] } },
      ],
    },
  };

  it('walks the page tree, sorted, with the root as the home page', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const files = await createNotionSource({
      name: 'n',
      rootId: root,
      token: 'secret_x',
      fetch: fakeFetch(table, calls),
    }).read();
    expect(() => assertSourceFiles(files)).not.toThrow();
    expect(files.map((f) => f.path)).toEqual([
      'getting-started-2.md',
      'getting-started.md',
      'index.md',
    ]);
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer secret_x');
    expect(calls[0]?.headers.get('notion-version')).toBe('2022-06-28');
    const home = files[2]?.content as string;
    expect(home).toContain('title: "Handbook"');
    expect(home).toContain('Hello **bold** [link](https://x.io)');
    expect(home).toContain('## Part');
    expect(home).toContain('- item\n  - sub item');
    expect(home).toContain('1. one\n2. two');
    expect(home).toContain('- [x] task');
    expect(home).toContain('```ts\nlet a = {};\n```');
    expect(home).toContain('> wise');
    expect(home).toContain(':::note\ncareful\n:::');
    expect(home).toContain('**More**');
    expect(home).toContain('![cap](https://x.io/i.png)');
    expect(home).not.toContain('insecure');
    expect(home).toContain('[https://x.io/bm](https://x.io/bm)');
  });

  it('refuses a bad id and a runaway tree', async () => {
    await expect(
      createNotionSource({ name: 'n', rootId: 'nope', token: 't' }).read(),
    ).rejects.toThrow(/page id/);
    await expect(
      createNotionSource({
        name: 'n',
        rootId: root,
        token: 't',
        limit: 2,
        fetch: fakeFetch(table),
      }).read(),
    ).rejects.toThrow(/more than 2 pages/);
  });

  it('writes blocks on their own', () => {
    expect(
      blockToMarkdown(
        { id: '1', type: 'paragraph', paragraph: { rich_text: [] } },
        '',
      ),
    ).toBeUndefined();
    expect(blockToMarkdown({ id: '1', type: 'divider' }, '')).toBe('---');
    expect(blockToMarkdown({ id: '1', type: 'column_list' }, 'inner')).toBe(
      'inner',
    );
    expect(
      blockToMarkdown(
        {
          id: '1',
          type: 'code',
          code: { rich_text: [rt('x')], language: 'plain text' },
        },
        '',
      ),
    ).toBe('```\nx\n```');
  });
});

describe('the docs folder and the filesystem sources', () => {
  it('reads pages, skipping hidden and underscore files, and never follows links', async () => {
    await put('index.mdx', '# Hi');
    await put('guides/a.md', 'A');
    await put('_snippets/s.mdx', 'S');
    await put('.hidden/x.md', 'X');
    await put('logo.png', 'png');
    await mkdir(join(dir, 'outside'), { recursive: true });
    await symlink(join(dir, 'guides'), join(dir, 'linked')).catch(
      () => undefined,
    );
    const files = await createLocalSource(dir).read();
    expect(files.map((f) => f.path)).toEqual(['guides/a.md', 'index.mdx']);
    await expect(
      createLocalSource(join(dir, 'missing')).read(),
    ).rejects.toThrow(/not found/);
  });

  it('reads a vault with its images', async () => {
    await put('Note.md', 'Hi ![[pic.png]]');
    await put('.obsidian/config.md', 'x');
    await put('assets/pic.png', new Uint8Array([7]));
    const files = await createVaultSource({ name: 'v', dir }).read();
    expect(files.map((f) => f.path)).toEqual(['assets/pic.png', 'note.md']);
  });
});

/** The same checks for every source: the contract of `ContentSource`. */
describe('ContentSource contract', () => {
  const cases: [string, () => Promise<ContentSource>][] = [
    [
      'local',
      async () => {
        await put('a.mdx', 'A');
        await put('b/c.md', 'C');
        return createLocalSource(dir);
      },
    ],
    [
      'obsidian',
      async () => {
        await put('One.md', 'See [[Two]]');
        await put('Two.md', 'Two');
        return createVaultSource({ name: 'v', dir });
      },
    ],
    [
      'html',
      async () => {
        await put('a.html', '<h1>A</h1>');
        await put('b/c.html', '<p>C</p>');
        return createHtmlSource({ name: 'h', dir });
      },
    ],
    [
      'remote',
      async () =>
        createRemoteSource({
          name: 'r',
          url: 'https://x.io/l',
          fetch: fakeFetch({
            'https://x.io/l': [
              { path: 'b.md', url: 'https://x.io/b' },
              { path: 'a.md', url: 'https://x.io/a' },
            ],
            'https://x.io/a': 'A',
            'https://x.io/b': 'B',
          }),
        }),
    ],
    [
      'sanity',
      async () =>
        createSanitySource({
          name: 's',
          projectId: 'p1',
          dataset: 'd',
          query: 'q',
          fetch: fakeFetch({
            [`https://p1.api.sanity.io/v2021-06-07/data/query/d?query=q`]: {
              result: [
                { title: 'T', slug: 'z', body: 'Z' },
                { title: 'U', slug: 'a', body: 'A' },
              ],
            },
          }),
        }),
    ],
    [
      'notion',
      async () =>
        createNotionSource({
          name: 'n',
          rootId: 'd'.repeat(32),
          token: 't',
          fetch: fakeFetch({
            [`https://api.notion.com/v1/pages/${'d'.repeat(32)}`]: {
              properties: {},
            },
            [`https://api.notion.com/v1/blocks/${'d'.repeat(32)}/children?page_size=100`]:
              {
                results: [
                  {
                    id: 'x',
                    type: 'paragraph',
                    paragraph: { rich_text: [{ plain_text: 'Hi' }] },
                  },
                ],
              },
          }),
        }),
    ],
  ];

  for (const [name, make] of cases) {
    it(`${name}: safe, unique, sorted paths; text pages; the same answer twice`, async () => {
      const source = await make();
      expect(source.name).toBeTruthy();
      const first = await source.read();
      expect(first.length).toBeGreaterThan(0);
      assertSourceFiles(first, name);
      expect(await source.read()).toEqual(first);
    });
  }
});

describe('sync', () => {
  const configured = (files: Record<string, string>): ConfiguredSource => ({
    into: 'imported',
    source: {
      name: 'demo',
      read: async () =>
        Object.entries(files)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([path, content]) => ({ path, content })),
    },
  });
  const docs = () => join(dir, 'docs');

  it('writes files, skips unchanged ones, removes what the source dropped, and keeps hand-written pages', async () => {
    await put('docs/imported/mine.md', 'by hand');
    const first = await syncSource(
      dir,
      docs(),
      configured({ 'a.md': 'A', 'sub/b.md': 'B' }),
    );
    expect(first).toEqual({
      name: 'demo',
      written: 2,
      unchanged: 0,
      removed: 0,
    });
    const second = await syncSource(
      dir,
      docs(),
      configured({ 'a.md': 'A2', 'sub/b.md': 'B' }),
    );
    expect(second).toMatchObject({ written: 1, unchanged: 1 });
    expect(await readFile(join(docs(), 'imported/a.md'), 'utf8')).toBe('A2');
    const third = await syncSource(dir, docs(), configured({ 'a.md': 'A2' }));
    expect(third).toMatchObject({ unchanged: 1, removed: 1 });
    expect((await readdir(join(docs(), 'imported'))).sort()).toEqual([
      'a.md',
      'mine.md',
      'sub',
    ]);
    expect(await readFile(join(docs(), 'imported/mine.md'), 'utf8')).toBe(
      'by hand',
    );
    expect(
      JSON.parse(
        await readFile(join(dir, '.dockudos/sources/demo.json'), 'utf8'),
      ),
    ).toEqual({ files: ['a.md'] });
  });

  it('refuses a source that breaks the contract, before writing anything', async () => {
    await expect(
      syncSource(dir, docs(), configured({ '../escape.md': 'x' })),
    ).rejects.toThrow(SourceError);
    await expect(readdir(docs())).rejects.toThrow();
  });

  it('builds sources from docs.json, reading secrets from the environment', async () => {
    const config = parseConfig({
      name: 'X',
      sources: [
        {
          type: 'remote',
          name: 'r',
          url: 'https://x.io/l',
          into: 'r',
          tokenEnv: 'R_TOKEN',
        },
        { type: 'obsidian', name: 'o', dir: 'vault', into: 'o' },
        { type: 'html', name: 'h', dir: 'html', into: 'h' },
        { type: 'notion', name: 'n', rootId: 'e'.repeat(32), into: 'n' },
        { type: 'sanity', name: 's', projectId: 'p', query: 'q', into: 's' },
      ],
    });
    const built = sourcesFromConfig(config, dir, {
      R_TOKEN: 'x',
      NOTION_TOKEN: 'y',
    });
    expect(built.map((b) => [b.source.name, b.into])).toEqual([
      ['r', 'r'],
      ['o', 'o'],
      ['h', 'h'],
      ['n', 'n'],
      ['s', 's'],
    ]);
    expect(() => sourcesFromConfig(config, dir, { NOTION_TOKEN: 'y' })).toThrow(
      /R_TOKEN/,
    );
  });

  it('validates the sources block', () => {
    expect(() =>
      parseConfig({
        name: 'X',
        sources: [
          { type: 'html', name: 'a', dir: 'd', into: 'x' },
          { type: 'html', name: 'a', dir: 'd', into: 'y' },
        ],
      }),
    ).toThrow(/used twice/);
    expect(() =>
      parseConfig({
        name: 'X',
        sources: [{ type: 'remote', name: 'r', url: 'not a url', into: 'x' }],
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        name: 'X',
        sources: [{ type: 'html', name: 'h', dir: 'd', into: '../x' }],
      }),
    ).toThrow(/folder path/);
  });
});
