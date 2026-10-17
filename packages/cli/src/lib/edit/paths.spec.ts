import {
  addToNav,
  classifyPath,
  cleanSvg,
  isPageId,
  mapNav,
  mediaType,
  sniffMedia,
} from './paths.ts';

describe('classifyPath', () => {
  it('allows docs.json, pages and media only', () => {
    expect(classifyPath('docs.json')).toBe('config');
    expect(classifyPath('docs/a.mdx')).toBe('doc');
    expect(classifyPath('docs/guides/b.md')).toBe('doc');
    expect(classifyPath('public/media/c.png')).toBe('media');
  });

  it.each([
    'package.json',
    'docs/a.txt',
    'docs/../x.mdx',
    'docs//a.mdx',
    'docs/.hidden/a.mdx',
    'docs/.a.mdx',
    'public/media/.secret',
    'public/media/sub/a.png',
    '.git/config',
    'docs/a b.mdx',
  ])('refuses %s', (path) => expect(classifyPath(path)).toBeUndefined());
});

describe('isPageId', () => {
  it('takes lowercase folders and names, nothing else', () => {
    expect(isPageId('a')).toBe(true);
    expect(isPageId('guides/get-started_2')).toBe(true);
    for (const bad of ['', 'A', '/a', 'a/', 'a//b', '../a', 'a b', '-a'])
      expect(isPageId(bad)).toBe(false);
  });
});

describe('sniffMedia', () => {
  const pad = (...b: number[]) =>
    Uint8Array.from([...b, ...new Array(16).fill(0)]);
  const text = (s: string) => new TextEncoder().encode(s.padEnd(16, ' '));

  it('identifies each type by its bytes', () => {
    expect(sniffMedia(pad(0x89, 0x50, 0x4e, 0x47))?.ext).toBe('png');
    expect(sniffMedia(pad(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe('jpg');
    expect(sniffMedia(text('GIF89a'))?.ext).toBe('gif');
    expect(sniffMedia(text('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
    expect(sniffMedia(text('%PDF-1.7'))?.ext).toBe('pdf');
    expect(sniffMedia(text('\0\0\0\x18ftypmp42'))?.ext).toBe('mp4');
    expect(
      sniffMedia(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))?.ext,
    ).toBe('svg');
    expect(
      sniffMedia(
        text('<?xml version="1.0"?>\n<!-- c -->\n<svg viewBox="0 0 1 1"/>'),
      )?.type,
    ).toBe('image/svg+xml');
  });

  it('refuses scripts, HTML, short input and look-alikes', () => {
    expect(sniffMedia(text('#!/bin/sh\necho hello world'))).toBeUndefined();
    expect(sniffMedia(text('<html><svg></svg></html>'))).toBeUndefined();
    expect(sniffMedia(Uint8Array.from([0x89, 0x50]))).toBeUndefined();
    expect(sniffMedia(text('RIFF\0\0\0\0WAVEfmt '))).toBeUndefined();
  });
});

describe('mediaType', () => {
  it('maps extensions, case-insensitively, and defaults to a download', () => {
    expect(mediaType('a.PNG')).toBe('image/png');
    expect(mediaType('a.svg')).toBe('image/svg+xml');
    expect(mediaType('a.bin')).toBe('application/octet-stream');
  });
});

describe('cleanSvg', () => {
  it('removes scripts, handlers, foreign objects and javascript: links', () => {
    const out = cleanSvg(
      '<svg onload="x()" ONCLICK=\'y()\'><script>alert(1)</script><foreignObject><div/></foreignObject><a href="javascript:alert(1)"><rect/></a><a xlink:href=\'javascript:1\'/></svg>',
    );
    expect(out).not.toMatch(/script|onload|onclick|foreignObject|javascript/i);
    expect(out).toContain('<rect/>');
  });
});

describe('navigation helpers', () => {
  const nav = [
    {
      tab: 'Docs',
      groups: [
        { group: 'A', pages: ['one', { group: 'Sub', pages: ['two'] }] },
        { group: 'B', pages: ['three'] },
      ],
    },
  ];

  it('mapNav renames, drops and leaves other values alone', () => {
    expect(mapNav(nav, (id) => (id === 'two' ? 'deux' : id))).toEqual([
      {
        tab: 'Docs',
        groups: [
          { group: 'A', pages: ['one', { group: 'Sub', pages: ['deux'] }] },
          { group: 'B', pages: ['three'] },
        ],
      },
    ]);
    expect(
      JSON.stringify(mapNav(nav, (id) => (id === 'one' ? null : id))),
    ).not.toContain('"one"');
    expect(mapNav(5, (id) => id)).toBe(5);
    expect(mapNav(undefined, (id) => id)).toBeUndefined();
  });

  it('addToNav appends to the first group with pages, searching nested groups, without changing the input', () => {
    const before = JSON.stringify(nav);
    const out = addToNav(nav, 'new') as typeof nav;
    expect(out[0]!.groups[0]!.pages).toEqual([
      'one',
      { group: 'Sub', pages: ['two'] },
      'new',
    ]);
    expect(JSON.stringify(nav)).toBe(before);
    const nested = addToNav(
      [
        {
          tab: 'T',
          groups: [
            { group: 'Outer', groups: [{ group: 'Inner', pages: ['x'] }] },
          ],
        },
      ],
      'y',
    );
    expect(JSON.stringify(nested)).toContain('"x","y"');
  });

  it('addToNav creates a tab when there is nowhere to put the page', () => {
    const made = { tab: 'Docs', groups: [{ group: 'Pages', pages: ['p'] }] };
    expect(addToNav(undefined, 'p')).toEqual([made]);
    expect(addToNav([], 'p')).toEqual([made]);
    expect(addToNav(['loose', 5, null], 'p')).toEqual(['loose', 5, null, made]);
  });
});
