import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { ChildProcess } from 'node:child_process';
import {
  buildEpub,
  bookIdentifier,
  imageType,
  type EpubChapter,
} from './epub.ts';
import { type Env } from './io.ts';
import { escapeXml, inlineToXhtml, markdownToXhtml } from './markdown-xhtml.ts';
import { printQuery } from './pdf.ts';
import { run } from './run.ts';
import { crc32, createZip } from './zip.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-p4-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function makeEnv(overrides: Partial<Env> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const children: {
    args: string[];
    child: EventEmitter & { kill(): boolean };
  }[] = [];
  const env: Env = {
    cwd: dir,
    vars: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    interactive: false,
    ask: async (_q, f) => f,
    spawn: ((_c: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { kill: () => true });
      children.push({ args, child });
      return child as unknown as ChildProcess;
    }) as Env['spawn'],
    watch: () => ({ close: () => undefined }),
    freePort: async () => 4555,
    fetch: async () => ({ status: 200 }),
    stdinLines: async function* () {
      /* none */
    },
    renderPdf: async () => new TextEncoder().encode('%PDF-fake'),
    ...overrides,
  };
  return {
    env,
    children,
    text: () => out.join(''),
    errText: () => err.join(''),
  };
}

async function files(map: Record<string, string>) {
  for (const [file, text] of Object.entries(map)) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), text);
  }
}
const page = (title: string, body: string, extra = '') =>
  `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

/** A reader for the archives we write, so tests do not trust the writer to check the writer. */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: {
    name: string;
    method: number;
    data: Uint8Array;
    crc: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    const raw = bytes.subarray(start, start + size);
    entries.push({
      name,
      method,
      crc,
      data: method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw,
    });
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return entries;
}

/** Is this XML well formed: tags nest and close, attributes are quoted, no stray `&` or `<`? */
function assertWellFormed(xml: string) {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '');
  const stack: string[] = [];
  for (const m of body.matchAll(
    /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g,
  )) {
    if (m[4]) continue;
    if (m[1]) expect(stack.pop(), `closing ${m[2]}`).toBe(m[2]);
    else stack.push(m[2] as string);
  }
  expect(stack).toEqual([]);
  const text = body.replace(/<[^>]*>/g, '');
  expect(text).not.toMatch(/[<>]/);
  expect(text).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#\d+;)/);
}

describe('zip', () => {
  it('writes an archive another reader can open, with correct checksums, stored and deflated entries', () => {
    const big = new TextEncoder().encode('hello hello hello '.repeat(200));
    const zip = createZip(
      [
        { name: 'a.txt', data: new TextEncoder().encode('A') },
        { name: 'dir/big.txt', data: big },
        { name: 'stored.txt', data: big, compress: false },
        { name: 'ünï.txt', data: new Uint8Array() },
      ],
      new Date(Date.UTC(2026, 2, 31, 10, 20, 30)),
    );
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      'a.txt',
      'dir/big.txt',
      'stored.txt',
      'ünï.txt',
    ]);
    expect(entries.map((e) => e.method)).toEqual([0, 8, 0, 0]); // tiny stays stored; big deflates; asked-for stays stored
    for (const e of entries) expect(crc32(e.data)).toBe(e.crc);
    expect(entries[1]?.data).toEqual(big);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is empty-safe and refuses more files than the format holds', () => {
    expect(readZip(createZip([]))).toEqual([]);
    expect(() =>
      createZip(
        Array.from({ length: 65_536 }, (_, i) => ({
          name: `${i}`,
          data: new Uint8Array(),
        })),
      ),
    ).toThrow(/Too many/);
  });
});

describe('Markdown to XHTML', () => {
  const o = {
    link: (h: string) => (h.startsWith('x:') ? undefined : h),
    image: (s: string) => (s.endsWith('.png') ? `images/${s}` : undefined),
  };
  const x = (md: string) => markdownToXhtml(md, o);

  it('writes headings with ids, paragraphs, emphasis, code and links', () => {
    const out = x(
      '# Title *here*\n\nSome **bold**, *soft*, ~~gone~~ and `a < b` with [a link](https://x.io/a?b=1&c=2) and <https://auto.io>.\nNext line  \nhard break.\n\n## Title *here*',
    );
    expect(out).toContain('<h1 id="title-here">Title <em>here</em></h1>');
    expect(out).toContain('<h2 id="title-here-1">');
    expect(out).toContain(
      '<strong>bold</strong>, <em>soft</em>, <del>gone</del> and <code>a &lt; b</code>',
    );
    expect(out).toContain('<a href="https://x.io/a?b=1&amp;c=2">a link</a>');
    expect(out).toContain('<a href="https://auto.io">https://auto.io</a>');
    expect(out).toContain('Next line<br/>\nhard break.');
    assertWellFormed(`<div>${out}</div>`);
  });

  it('turns links and images the book cannot keep into text', () => {
    expect(
      x(
        '[gone](x:nothing) and ![alt text](a.png) and ![remote](https://x.io/i.jpg) and [![img](a.png)](https://x.io)',
      ),
    ).toContain(
      '<p>gone and <img src="images/a.png" alt="alt text"/> and remote and <a href="https://x.io"><img src="images/a.png" alt="img"/></a></p>',
    );
    expect(inlineToXhtml('[a [b](c)](d)', o)).toContain('a b');
    expect(inlineToXhtml('\\*not bold\\* \\[x\\]', o)).toBe('*not bold* [x]');
  });

  it('writes lists, nested and numbered, tight and task lists', () => {
    const out = x(
      '- one\n- two\n  - nested a\n  - nested b\n- three\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo\n\nbetween\n\n* a\n\n* b',
    );
    expect(out).toContain(
      '<ul><li>one</li><li>two<ul><li>nested a</li><li>nested b</li></ul></li><li>three</li></ul>',
    );
    expect(out).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(out).toContain('<li>☑ done</li><li>☐ todo</li>');
    expect(out).toContain('<ul><li>a</li><li>b</li></ul>');
    assertWellFormed(`<div>${out}</div>`);
  });

  it('writes quotes, rules, fences and tables', () => {
    const out = x(
      '> quoted *text*\n> second\n\n---\n\n```ts\nconst a = "<b>" && c;\n```\n\n~~~\nplain\n~~~\n\n| A | B |\n| --- | :-: |\n| 1 | a\\|b |\n| 2 |\n\nlast',
    );
    expect(out).toContain(
      '<blockquote><p>quoted <em>text</em>\nsecond</p></blockquote>',
    );
    expect(out).toContain('<hr/>');
    expect(out).toContain(
      '<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot; &amp;&amp; c;</code></pre>',
    );
    expect(out).toContain('<pre><code>plain</code></pre>');
    expect(out).toContain(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>a|b</td></tr><tr><td>2</td><td></td></tr></tbody></table>',
    );
    expect(out).toContain('<p>last</p>');
    assertWellFormed(`<div>${out}</div>`);
  });

  it('never lets markup through, and copes with unclosed fences and odd input', () => {
    const out = x(
      '<script>alert(1)</script> <b onclick="x">hi</b> & more\n\n```\nnever closed\n\u0000bell',
    );
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('never closed');
    assertWellFormed(`<div>${out}</div>`);
    expect(x('')).toBe('');
    expect(x('\r\n\r\ntab\there\r\n')).toBe('<p>tab    here</p>');
    expect(escapeXml('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });
});

describe('buildEpub', () => {
  const chapter = (
    n: number,
    extra: Partial<EpubChapter> = {},
  ): EpubChapter => ({
    path: `/c${n}`,
    title: `Chapter <${n}> & more`,
    markdown: `# Chapter ${n}\n\nText ${n}.`,
    file: `c${n}.mdx`,
    mount: '',
    ...extra,
  });
  const build = (chapters: EpubChapter[], extra = {}) =>
    readZip(
      buildEpub({
        title: 'Book & "Co"',
        language: 'en',
        identifier: 'urn:uuid:1',
        modified: new Date('2026-03-31T10:20:30.456Z'),
        chapters,
        ...extra,
      }),
    );
  const get = (entries: ReturnType<typeof readZip>, name: string) =>
    new TextDecoder().decode(entries.find((e) => e.name === name)?.data);

  it('follows the EPUB container rules: mimetype first and stored, container.xml, package, navigation', () => {
    const entries = build([
      chapter(1, { section: 'Start' }),
      chapter(2, { section: 'Start' }),
      chapter(3, { section: 'More' }),
      chapter(4),
    ]);
    expect(entries[0]).toMatchObject({ name: 'mimetype', method: 0 });
    expect(new TextDecoder().decode(entries[0]?.data)).toBe(
      'application/epub+zip',
    );
    expect(entries.map((e) => e.name)).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/style.css',
      'OEBPS/chapter-001.xhtml',
      'OEBPS/chapter-002.xhtml',
      'OEBPS/chapter-003.xhtml',
      'OEBPS/chapter-004.xhtml',
    ]);
    for (const e of entries) expect(crc32(e.data)).toBe(e.crc);
    for (const name of [
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/chapter-001.xhtml',
    ])
      assertWellFormed(get(entries, name));

    const opf = get(entries, 'OEBPS/content.opf');
    expect(opf).toContain('<dc:title>Book &amp; &quot;Co&quot;</dc:title>');
    expect(opf).toContain('<dc:language>en</dc:language>');
    expect(opf).toContain(
      '<meta property="dcterms:modified">2026-03-31T10:20:30Z</meta>',
    );
    expect(opf).toContain('properties="nav"');
    expect(opf.match(/<itemref /g)).toHaveLength(5);
    expect(opf).toContain('<itemref idref="ch4"/>');
    const manifestIds = [...opf.matchAll(/<item id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    for (const [, id] of opf.matchAll(/<itemref idref="([^"]+)"/g))
      expect(manifestIds).toContain(id);

    const nav = get(entries, 'OEBPS/nav.xhtml');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('<li><span>Start</span><ol>');
    expect(nav).toContain(
      '<a href="chapter-003.xhtml">Chapter &lt;3&gt; &amp; more</a>',
    );
    expect(nav.match(/<span>/g)).toHaveLength(2);
  });

  it('links chapters to each other and keeps only safe external links', () => {
    const entries = build([
      chapter(1, {
        markdown:
          '# One\n\n[two](./c2.mdx#part) [self](#top) [web](https://x.io) [mail](mailto:a@b.io) [bad](javascript:x) [gone](./nope.mdx) [file](./f.pdf)',
      }),
      chapter(2, { markdown: '# Two\n\n## Part' }),
    ]);
    const one = get(entries, 'OEBPS/chapter-001.xhtml');
    expect(one).toContain('<a href="chapter-002.xhtml#part">two</a>');
    expect(one).toContain('<a href="#top">self</a>');
    expect(one).toContain('<a href="https://x.io">web</a>');
    expect(one).toContain('<a href="mailto:a@b.io">mail</a>');
    expect(one).not.toContain('javascript');
    expect(one).toContain('gone');
    expect(one).not.toContain('nope');
    assertWellFormed(one);
  });

  it('embeds images the caller provides and shows the alt text for the rest', () => {
    const entries = build(
      [chapter(1, { markdown: '![local](a.png) ![away](https://x.io/b.png)' })],
      {
        image: (src: string) =>
          src === 'a.png'
            ? {
                name: 'images/a1.png',
                mediaType: 'image/png',
                data: new Uint8Array([1, 2]),
              }
            : undefined,
      },
    );
    expect(entries.map((e) => e.name)).toContain('OEBPS/images/a1.png');
    expect(get(entries, 'OEBPS/content.opf')).toContain(
      'href="images/a1.png" media-type="image/png"',
    );
    const html = get(entries, 'OEBPS/chapter-001.xhtml');
    expect(html).toContain('<img src="images/a1.png" alt="local"/>');
    expect(html).toContain('away');
    expect(html).not.toContain('x.io/b.png');
  });

  it('reads right to left for Arabic', () => {
    const entries = build([chapter(1)], { language: 'ar', rtl: true });
    expect(get(entries, 'OEBPS/content.opf')).toContain(
      'page-progression-direction="rtl"',
    );
    expect(get(entries, 'OEBPS/chapter-001.xhtml')).toContain('dir="rtl"');
  });

  it('gives the same book the same identifier', () => {
    expect(bookIdentifier('Acme', 'v1/fr')).toBe(
      bookIdentifier('Acme', 'v1/fr'),
    );
    expect(bookIdentifier('Acme', 'v1/fr')).not.toBe(
      bookIdentifier('Acme', 'v2/fr'),
    );
    expect(bookIdentifier('Acme', '')).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(imageType('X.PNG')).toBe('image/png');
    expect(imageType('x.exe')).toBeUndefined();
  });
});

const SITE = {
  'docs.json': JSON.stringify({
    name: 'Acme Docs',
    versions: {
      default: 'v2',
      list: [{ name: 'v2' }, { name: 'v1', label: '1.x' }],
    },
    i18n: { default: 'en', locales: ['en', 'ar'] },
    access: { rules: [{ paths: ['/private'], require: 'deny' }] },
    navigation: [
      {
        tab: 'Docs',
        groups: [{ group: 'Guides', pages: ['index', 'guides/a', 'guides/b'] }],
      },
    ],
  }),
  'docs/v2/en/index.mdx': page(
    'Home',
    'Welcome. See [A](./guides/a.mdx#setup).\n\n![logo](./logo.png)\n\n![root](/pic.png)',
  ),
  'docs/v2/en/guides/a.mdx': page(
    'Alpha',
    '## Setup\n\nAlpha text with `code`.',
  ),
  'docs/v2/en/guides/b.mdx': page('Beta', 'Beta text.'),
  'docs/v2/en/private.mdx': page('Private', 'SECRET-PRIVATE'),
  'docs/v2/en/logo.png': 'not-an-image-but-bytes',
  'docs/v2/ar/index.mdx': page('الرئيسية', 'مرحبا'),
  'docs/v1/en/index.mdx': page('Home 1', 'Old home.'),
  'docs/v1/en/guides/a.mdx': page('Alpha 1', 'Old alpha.'),
  'docs/v1/ar/index.mdx': page('الرئيسية 1', 'قديم'),
  'package.json': '{"name":"p"}',
  'public/pic.png': 'public-bytes',
};

describe('dockudos epub', () => {
  it('writes the default book in sidebar order, with images from the project and without protected pages', async () => {
    await files(SITE);
    const t = makeEnv({ vars: { SOURCE_DATE_EPOCH: '1774952430' } });
    expect(await run(['epub'], t.env)).toBe(0);
    const entries = readZip(
      new Uint8Array(await readFile(join(dir, 'acme-docs-v2-en.epub'))),
    );
    const names = entries.map((e) => e.name);
    expect(names).toContain('OEBPS/chapter-003.xhtml');
    expect(names.filter((n) => n.startsWith('OEBPS/images/'))).toHaveLength(2);
    const all = entries.map((e) => new TextDecoder().decode(e.data)).join('\n');
    expect(all).not.toContain('SECRET-PRIVATE');
    const opf = new TextDecoder().decode(
      entries.find((e) => e.name === 'OEBPS/content.opf')?.data,
    );
    expect(opf).toContain('<dc:title>Acme Docs</dc:title>');
    expect(opf).toContain('2026-03-31T');
    const first = new TextDecoder().decode(
      entries.find((e) => e.name === 'OEBPS/chapter-001.xhtml')?.data,
    );
    expect(first).toContain('<a href="chapter-002.xhtml#setup">A</a>');
    expect(t.text()).toContain('3 pages; left out 1 protected');
  });

  it('never puts a file from outside the project into the book', async () => {
    await mkdir(join(dir, 'outside'), { recursive: true });
    await writeFile(join(dir, 'outside', 'secret.png'), 'OUTSIDE-SECRET');
    const project = join(dir, 'proj');
    await mkdir(join(project, 'docs'), { recursive: true });
    await mkdir(join(project, 'public'), { recursive: true });
    await writeFile(join(project, 'docs.json'), '{"name":"P"}');
    await writeFile(join(project, 'package.json'), '{}');
    await writeFile(
      join(project, 'docs/index.mdx'),
      page(
        'Home',
        '![up](../../outside/secret.png) ![abs](/../outside/secret.png) ![link](/linked.png) ![ok](/ok.png)',
      ),
    );
    await writeFile(join(project, 'public/ok.png'), 'INSIDE');
    const { symlink } = await import('node:fs/promises');
    await symlink(
      join(dir, 'outside', 'secret.png'),
      join(project, 'public/linked.png'),
    ).catch(() => undefined);
    const t = makeEnv({ cwd: project });
    expect(await run(['epub'], t.env)).toBe(0);
    const entries = readZip(
      new Uint8Array(await readFile(join(project, 'p.epub'))),
    );
    const all = entries.map((e) => new TextDecoder().decode(e.data)).join('\n');
    expect(all).not.toContain('OUTSIDE-SECRET');
    expect(all).toContain('INSIDE');
    expect(
      entries.filter((e) => e.name.startsWith('OEBPS/images/')),
    ).toHaveLength(1);
  });

  it('picks a version, a language and a section', async () => {
    await files(SITE);
    const t = makeEnv();
    expect(
      await run(['epub', '--version', 'v1', '-o', 'old.epub'], t.env),
    ).toBe(0);
    const old = readZip(new Uint8Array(await readFile(join(dir, 'old.epub'))));
    expect(
      new TextDecoder().decode(
        old.find((e) => e.name === 'OEBPS/content.opf')?.data,
      ),
    ).toContain('<dc:title>Acme Docs – 1.x</dc:title>');
    expect(
      old.filter(
        (e) => e.name.endsWith('.xhtml') && e.name.includes('chapter'),
      ),
    ).toHaveLength(2);

    expect(await run(['epub', '--locale', 'ar'], t.env)).toBe(0);
    const ar = readZip(
      new Uint8Array(await readFile(join(dir, 'acme-docs-v2-ar.epub'))),
    );
    const opf = new TextDecoder().decode(
      ar.find((e) => e.name === 'OEBPS/content.opf')?.data,
    );
    expect(opf).toContain('<dc:language>ar</dc:language>');
    expect(opf).toContain('page-progression-direction="rtl"');
    // the Arabic version lacks the guides: the book has the pages it has, and leaves out the untranslated stand-ins
    expect(t.text()).toContain('left out');

    expect(
      await run(['epub', '--path', '/guides', '-o', 'guides.epub'], t.env),
    ).toBe(0);
    const part = readZip(
      new Uint8Array(await readFile(join(dir, 'guides.epub'))),
    );
    expect(
      new TextDecoder().decode(
        part.find((e) => e.name === 'OEBPS/content.opf')?.data,
      ),
    ).toContain('<dc:title>Acme Docs – Alpha</dc:title>');
    expect(part.filter((e) => e.name.includes('chapter-'))).toHaveLength(2);
  });

  it('says what is wrong: unknown version, bad path, nothing to put in the book', async () => {
    await files(SITE);
    const t = makeEnv();
    expect(await run(['epub', '--version', 'v9'], t.env)).toBe(1);
    expect(t.errText()).toContain('Unknown version "v9"');
    expect(await run(['epub', '--path', 'guides'], t.env)).toBe(1);
    expect(t.errText()).toContain('--path must be an address');
    expect(await run(['epub', '--path', '/nothing'], t.env)).toBe(1);
    expect(t.errText()).toContain('No pages to put in the book below /nothing');
  });

  it('works on a site with neither versions nor languages', async () => {
    await files({
      'docs.json': '{"name":"Plain"}',
      'docs/index.mdx': page('Home', 'Hello'),
      'package.json': '{}',
    });
    const t = makeEnv();
    expect(await run(['epub'], t.env)).toBe(0);
    expect((await readFile(join(dir, 'plain.epub'))).length).toBeGreaterThan(
      100,
    );
  });
});

describe('dockudos pdf scope', () => {
  it('builds the query for a version, language and section', () => {
    expect(printQuery({})).toBe('');
    expect(printQuery({ version: 'v1', locale: 'fr', path: '/guides' })).toBe(
      '?version=v1&locale=fr&path=%2Fguides',
    );
    expect(() => printQuery({ path: 'guides' })).toThrow(/--path must be/);
    expect(() => printQuery({ path: '/a b' })).toThrow(/--path must be/);
  });

  it('prints the scoped /print page', async () => {
    await files({
      'docs.json': '{"name":"Acme"}',
      'docs/index.mdx': '# Home',
      'package.json': '{}',
      '.next/BUILD_ID': 'x',
      'node_modules/next/package.json': '{}',
      'node_modules/next/dist/bin/next': '',
    });
    const urls: string[] = [];
    const t = makeEnv({
      renderPdf: async (o) => (
        urls.push(o.url),
        new TextEncoder().encode('%PDF')
      ),
      fetch: async (u) => (urls.push(u), { status: 200 }),
    });
    const code = await run(
      ['pdf', '--no-build', '--version', 'v1', '--path', '/guides'],
      t.env,
    );
    expect(code).toBe(0);
    expect(urls).toEqual([
      'http://127.0.0.1:4555/print?version=v1&path=%2Fguides',
      'http://127.0.0.1:4555/print?version=v1&path=%2Fguides',
    ]);
  });
});

describe('dockudos sync', () => {
  const docs = (sources: object[]) => ({
    'docs.json': JSON.stringify({ name: 'S', sources }),
    'docs/index.mdx': '# Home',
    'package.json': '{}',
  });

  it('says so when there is nothing to sync', async () => {
    await files(docs([]));
    const t = makeEnv();
    expect(await run(['sync'], t.env)).toBe(0);
    expect(t.text()).toContain('Nothing to sync');
  });

  it('converts a vault and an HTML folder into the docs, and reports each source', async () => {
    await files({
      ...docs([
        { type: 'obsidian', name: 'vault', dir: 'vault', into: 'notes' },
        { type: 'html', name: 'legacy', dir: 'legacy', into: 'old' },
      ]),
      'vault/Start.md': '# Start\n\nSee [[Other]] {x}',
      'vault/Other.md': 'Other',
      'legacy/a.html':
        '<title>Old A</title><main><h1>Old A</h1><p>Hi</p></main>',
    });
    const t = makeEnv();
    expect(await run(['sync'], t.env)).toBe(0);
    expect(t.text()).toContain('vault: 2 written, 0 unchanged, 0 removed.');
    expect(t.text()).toContain('legacy: 1 written');
    expect(await readFile(join(dir, 'docs/notes/start.md'), 'utf8')).toContain(
      '[Other](other)',
    );
    expect(await readFile(join(dir, 'docs/old/a.md'), 'utf8')).toContain(
      'title: "Old A"',
    );
    // again: nothing to rewrite; one source only
    const again = makeEnv();
    expect(await run(['sync', 'vault'], again.env)).toBe(0);
    expect(again.text()).toContain('vault: 0 written, 2 unchanged');
    expect(again.text()).not.toContain('legacy');
  });

  it('refuses an unknown source, an unknown option, a missing secret and a broken source', async () => {
    await files({
      ...docs([
        { type: 'notion', name: 'wiki', rootId: 'a'.repeat(32), into: 'wiki' },
        { type: 'obsidian', name: 'v', dir: 'missing', into: 'v' },
      ]),
    });
    const t = makeEnv();
    expect(await run(['sync', 'nope'], t.env)).toBe(1);
    expect(t.errText()).toContain('No source named "nope"');
    expect(await run(['sync', '--force'], t.env)).toBe(1);
    expect(await run(['sync', 'wiki'], t.env)).toBe(1);
    expect(t.errText()).toContain('NOTION_TOKEN');
    expect(await run(['sync', 'v'], t.env)).toBe(1);
    expect(t.errText()).toContain('Folder not found');
  });

  it('runs before a build, and --no-sync skips it', async () => {
    await files({
      ...docs([{ type: 'html', name: 'legacy', dir: 'legacy', into: 'old' }]),
      'legacy/a.html': '<h1>A</h1>',
      'node_modules/next/package.json': '{}',
      'node_modules/next/dist/bin/next': '',
    });
    const t = makeEnv();
    const done = run(['build'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    t.children[0]!.child.emit('exit', 0);
    await done;
    expect(await readFile(join(dir, 'docs/old/a.md'), 'utf8')).toContain('# A');
    await rm(join(dir, 'docs/old'), { recursive: true });
    const skip = makeEnv();
    const second = run(['build', '--no-sync'], skip.env);
    await vi.waitFor(() => expect(skip.children).toHaveLength(1));
    skip.children[0]!.child.emit('exit', 0);
    await second;
    await expect(
      readFile(join(dir, 'docs/old/a.md'), 'utf8'),
    ).rejects.toThrow();
  });
});

describe('static export with versions and languages', () => {
  async function exportSite(extra: Record<string, string> = {}) {
    await files({
      ...SITE,
      'node_modules/next/package.json': '{}',
      'node_modules/next/dist/bin/next': '',
      ...extra,
    });
    const t = makeEnv();
    const done = run(['build', '--static'], t.env);
    await vi.waitFor(() => expect(t.children).toHaveLength(1));
    t.children[0]!.child.emit('exit', 0);
    expect(await done).toBe(0);
    return t;
  }
  const read = (file: string) => readFile(join(dir, 'out', file), 'utf8');

  it('writes an index file per version and language, and a Markdown twin of every public page', async () => {
    await exportSite();
    const pages = async (file: string) =>
      JSON.parse(await read(file)).pages as {
        path: string;
        version: string;
        locale: string;
      }[];
    const main = await pages('api/search/index');
    expect(main.map((p) => p.path)).toContain('/guides/a');
    expect(main.every((p) => p.version === 'v2' && p.locale === 'en')).toBe(
      true,
    );
    expect(await pages('api/search/index-v2~en')).toEqual(main);
    expect((await pages('api/search/index-v1~en')).map((p) => p.path)).toEqual([
      '/v1',
      '/v1/guides/a',
    ]);
    expect(
      (await pages('api/search/index-v2~ar')).every((p) => p.locale === 'ar'),
    ).toBe(true);
    expect(await read('index.md')).toContain('# Home');
    expect(await read('v1/guides/a.md')).toContain('Old alpha');
    expect(await read('ar.md')).toContain('مرحبا');
    // nothing protected, anywhere
    await expect(read('private.md')).rejects.toThrow();
    expect(await read('api/search/index')).not.toContain('SECRET');
    for (const file of ['api/search/index-v1~ar', 'api/search/index-v2~ar'])
      expect(await read(file)).not.toContain('SECRET');
  });

  it('draws social cards with the renderer of the project, and skips them without one', async () => {
    const t = await exportSite({
      'docs.json': JSON.stringify({
        ...JSON.parse(SITE['docs.json']),
        seo: { siteUrl: 'https://x.io' },
      }),
    });
    expect(t.errText()).toContain('Social-card images skipped');
    await rm(join(dir, 'out'), { recursive: true });
    class ImageResponse extends Response {
      constructor(element: { props: { style: { background: string } } }) {
        super(
          new Uint8Array([
            0x89,
            0x50,
            0x4e,
            0x47,
            element.props.style.background === '#111827' ? 1 : 2,
          ]),
        );
      }
    }
    await files({
      'node_modules/next/og.js': `exports.ImageResponse = ${ImageResponse.toString().replace('ImageResponse', 'ImageResponse')};`,
    });
    // a renderer that fails for one page: the others are still written
    await files({
      'node_modules/next/og.js':
        'exports.ImageResponse = class extends Response { constructor(el) { if (JSON.stringify(el).includes("Alpha 1")) throw new Error("boom"); super(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); } };',
    });
    const again = makeEnv();
    const done = run(['build', '--static'], again.env);
    await vi.waitFor(() => expect(again.children).toHaveLength(1));
    again.children[0]!.child.emit('exit', 0);
    await done;
    expect([...(await readFile(join(dir, 'out/og/guides/a.png')))]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
    expect((await readFile(join(dir, 'out/og/index.png'))).length).toBe(4);
    await expect(readFile(join(dir, 'out/og/private.png'))).rejects.toThrow();
    await expect(
      readFile(join(dir, 'out/og/v1/guides/a.png')),
    ).rejects.toThrow();
    expect(again.errText()).toContain(
      'Social card for /v1/guides/a skipped: boom',
    );
  });
});

describe('the project with versions and languages', () => {
  it('loads every view and checks links inside each version and language', async () => {
    await files({
      ...SITE,
      'docs/v2/en/guides/b.mdx': page(
        'Beta',
        '[to alpha](./a.mdx) and [home](../index.mdx) and [old](/v1/guides/a) and [missing](./zzz.mdx)',
      ),
    });
    const t = makeEnv();
    expect(await run(['broken-links'], t.env)).toBe(1);
    const report = t.errText();
    expect(report).toContain('v2/en/guides/b.mdx:5');
    expect(report).toContain('no page at /guides/zzz');
    // the three that are fine are not reported
    expect(report).not.toContain('./a.mdx');
    expect(report).not.toContain('/v1/guides/a  ');
  });

  it('fails clearly when pages are not where the layout says', async () => {
    await files({
      'docs.json': SITE['docs.json'],
      'docs/index.mdx': '# Home',
      'package.json': '{}',
    });
    const t = makeEnv();
    expect(await run(['broken-links'], t.env)).toBe(1);
    expect(t.errText()).toContain('docs/v2/en/index.mdx');
  });

  it('generates API pages into the default version and language', async () => {
    await files({
      'docs.json': JSON.stringify({
        name: 'A',
        versions: { default: 'v2', list: [{ name: 'v2' }] },
        i18n: { default: 'en', locales: ['en'] },
        openapi: { sources: [{ name: 'pets', spec: 'pets.json' }] },
      }),
      'pets.json': JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Pets', version: '1' },
        paths: {
          '/pets': {
            get: {
              summary: 'List',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
      'docs/v2/en/index.mdx': '# Home',
      'package.json': '{}',
    });
    const t = makeEnv();
    expect(await run(['generate'], t.env)).toBe(0);
    const written = await readFile(
      join(dir, 'docs/v2/en/pets/index.mdx'),
      'utf8',
    ).catch(() => '');
    expect(written).toContain('Pets');
  });
});
