import {
  buildRss,
  extractUpdates,
  rfc822,
  sortNewestFirst,
  updateAnchor,
} from './feed.ts';

const page = `---
title: Changelog
---

# Changelog

<Update label="1.4.0" date="2026-03-31" tags={["Added", 'Breaking']} description="The big one">

- New \`thing\`
- A > B & C

</Update>

\`\`\`mdx
<Update label="not real" date="2020-01-01">example</Update>
\`\`\`

<Update label={"1.3.0"} date="2026-02-01">
Fixed it.
</Update>

<Update label="1.4.0" date="2026-01-01" description="a > b">
same label again
</Update>

<Update label="no date" date="31/03/2026" />

<Update date="2026-01-01">no label</Update>
`;

describe('extractUpdates', () => {
  const entries = extractUpdates(page);

  it('reads label, date, tags, description and body', () => {
    expect(entries[0]).toMatchObject({
      label: '1.4.0',
      date: '2026-03-31',
      tags: ['Added', 'Breaking'],
      description: 'The big one',
      anchor: '1-4-0',
    });
    expect(entries[0]?.body).toContain('- A > B & C');
    expect(entries[1]).toMatchObject({
      label: '1.3.0',
      date: '2026-02-01',
      tags: [],
      body: 'Fixed it.',
    });
  });

  it('ignores entries in code, self-closing entries and entries without a label', () => {
    expect(entries.map((e) => e.label)).toEqual(['1.4.0', '1.3.0', '1.4.0']);
  });

  it('keeps ids unique and reads `>` inside attribute values', () => {
    expect(entries.map((e) => e.anchor)).toEqual(['1-4-0', '1-3-0', '1-4-0-2']);
    expect(entries[2]?.description).toBe('a > b');
  });

  it('drops dates that are not real', () => {
    expect(
      extractUpdates('<Update label="x" date="2026-13-45">b</Update>')[0]?.date,
    ).toBeUndefined();
    expect(
      extractUpdates('<Update label="x" date="soon">b</Update>')[0]?.date,
    ).toBeUndefined();
  });

  it('copes with unclosed tags', () => {
    expect(extractUpdates('<Update label="x"')).toEqual([]);
    expect(extractUpdates('<Update label="x">never closed')).toEqual([]);
    expect(extractUpdates('no entries')).toEqual([]);
  });

  it('uses the same id as the page', () => {
    expect(updateAnchor('Version 2.0 — Beta!')).toBe('version-2-0-beta');
  });
});

describe('buildRss', () => {
  const channel = {
    title: 'Acme <Changelog>',
    link: 'https://docs.acme.com/changelog',
    description: 'What changed',
    self: 'https://docs.acme.com/changelog.xml',
    language: 'en',
    items: [
      {
        title: '1.4.0 & more',
        link: 'https://docs.acme.com/changelog#1-4-0',
        date: '2026-03-31',
        description: 'A > B',
        categories: ['Added'],
      },
      {
        title: '1.3.0',
        link: 'https://docs.acme.com/changelog#1-3-0',
        date: '2026-02-01T10:00:00Z',
        guid: 'acme-1.3.0',
      },
      { title: 'bad link', link: 'javascript:alert(1)' },
      { title: '', link: 'https://docs.acme.com/x' },
    ],
  };
  const xml = buildRss(channel);

  it('is an RSS 2.0 document with the required channel elements', () => {
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"',
      ),
    ).toBe(true);
    for (const tag of ['title', 'link', 'description'])
      expect(xml).toMatch(new RegExp(`<channel>[\\s\\S]*<${tag}>`));
    expect(xml).toContain(
      '<atom:link href="https://docs.acme.com/changelog.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(xml).toContain('<language>en</language>');
  });

  it('escapes text and keeps only http(s) links and titled items', () => {
    expect(xml).toContain('<title>Acme &lt;Changelog&gt;</title>');
    expect(xml).toContain('<title>1.4.0 &amp; more</title>');
    expect(xml).toContain('<description>A &gt; B</description>');
    expect(xml).not.toContain('javascript:');
    expect(xml.match(/<item>/g)).toHaveLength(2);
  });

  it('writes RFC 822 dates, guids, categories and the newest date as lastBuildDate', () => {
    expect(xml).toContain('<pubDate>Tue, 31 Mar 2026 00:00:00 GMT</pubDate>');
    expect(xml).toContain('<pubDate>Sun, 01 Feb 2026 10:00:00 GMT</pubDate>');
    expect(xml).toContain(
      '<lastBuildDate>Tue, 31 Mar 2026 00:00:00 GMT</lastBuildDate>',
    );
    expect(xml).toContain(
      '<guid isPermaLink="true">https://docs.acme.com/changelog#1-4-0</guid>',
    );
    expect(xml).toContain('<guid isPermaLink="false">acme-1.3.0</guid>');
    expect(xml).toContain('<category>Added</category>');
    expect(rfc822(new Date('2026-03-31T00:00:00Z'))).toMatch(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    );
  });

  it('is well-formed XML: every tag closes, in order', () => {
    const stack: string[] = [];
    for (const [, close, name, selfClose] of xml
      .replaceAll(/<\?[\s\S]*?\?>/g, '')
      .matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (selfClose) continue;
      if (close) expect(stack.pop()).toBe(name);
      else stack.push(name as string);
    }
    expect(stack).toEqual([]);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('strips characters XML cannot hold, applies the limit and omits what is unknown', () => {
    const odd = buildRss({
      title: 'a\u0000b\u0008c',
      link: 'https://x.io',
      description: '',
      items: [
        { title: 'one', link: 'https://x.io/1' },
        { title: 'two', link: 'https://x.io/2' },
      ],
      limit: 1,
    });
    expect(odd).toContain('<title>abc</title>');
    expect(odd).toContain('<description>abc</description>');
    expect(odd.match(/<item>/g)).toHaveLength(1);
    expect(odd).not.toContain('lastBuildDate');
    expect(odd).not.toContain('pubDate');
    expect(odd).not.toContain('atom:link');
  });

  it('is the same file for the same content', () => {
    expect(buildRss(channel)).toBe(xml);
  });
});

describe('sortNewestFirst', () => {
  it('puts newest first and undated last, keeping ties in order', () => {
    const items = [
      { id: 'u1' },
      { id: 'old', date: '2025-01-01' },
      { id: 'new', date: '2026-01-01' },
      { id: 'u2' },
      { id: 'same', date: '2025-01-01' },
    ];
    expect(sortNewestFirst(items).map((i) => i.id)).toEqual([
      'new',
      'old',
      'same',
      'u1',
      'u2',
    ]);
  });
});
