import {
  INDEX_VERSION,
  type IndexInput,
  buildContentIndex,
  isContentIndex,
  isIndexable,
} from './content-index.ts';
import { parseConfig } from './config.ts';

const input = (path: string, body: string, title = path): IndexInput => ({
  path,
  title,
  body,
});

const NOW = new Date('2030-01-01T00:00:00Z');

describe('buildContentIndex', () => {
  it('records pages and chunks', () => {
    const { index } = buildContentIndex(
      [
        {
          path: '/guides/auth',
          title: 'Auth',
          description: 'How to sign in',
          body: 'Intro.\n\n## Keys\n\nUse a key.',
        },
      ],
      { now: NOW },
    );
    expect(index.version).toBe(INDEX_VERSION);
    expect(index.builtAt).toBe('2030-01-01T00:00:00.000Z');
    expect(index.pages).toMatchObject([
      {
        path: '/guides/auth',
        title: 'Auth',
        description: 'How to sign in',
        headings: [{ id: 'keys', text: 'Keys', depth: 2 }],
      },
    ]);
    expect(index.chunks.map((c) => [c.headingPath, c.anchor, c.text])).toEqual([
      [[], '', 'Intro.'],
      [['Keys'], 'keys', 'Use a key.'],
    ]);
  });

  it('reuses unchanged pages and their chunks, rebuilding only what changed', () => {
    const first = buildContentIndex(
      [input('/a', '## A\n\none'), input('/b', '## B\n\ntwo')],
      { now: NOW },
    );
    expect(first.reusedPages).toBe(0);
    expect(first.rebuiltPages).toBe(2);

    // A vector on a reused chunk survives.
    const chunkA = first.index.chunks.find((c) => c.pagePath === '/a');
    if (chunkA) chunkA.vector = [1, 2, 3];

    const second = buildContentIndex(
      [input('/a', '## A\n\none'), input('/b', '## B\n\ntwo changed')],
      { previous: first.index, now: NOW },
    );
    expect(second.reusedPages).toBe(1);
    expect(second.rebuiltPages).toBe(1);
    expect(
      second.index.chunks.find((c) => c.pagePath === '/a')?.vector,
    ).toEqual([1, 2, 3]);
    expect(second.index.chunks.find((c) => c.pagePath === '/b')?.text).toBe(
      'two changed',
    );
    expect(second.index.pages.find((p) => p.path === '/a')).toBe(
      first.index.pages.find((p) => p.path === '/a'),
    );
  });

  it('drops pages that no longer exist', () => {
    const first = buildContentIndex([input('/a', 'x'), input('/b', 'y')]);
    const second = buildContentIndex([input('/a', 'x')], {
      previous: first.index,
    });
    expect(second.index.pages.map((p) => p.path)).toEqual(['/a']);
    expect(second.index.chunks.map((c) => c.pagePath)).toEqual(['/a']);
  });

  it('rebuilds everything when the title or size cap changes', () => {
    const first = buildContentIndex([input('/a', 'x', 'Old')]);
    expect(
      buildContentIndex([input('/a', 'x', 'New')], { previous: first.index })
        .rebuiltPages,
    ).toBe(1);
    expect(
      buildContentIndex([input('/a', 'x', 'Old')], {
        previous: first.index,
        maxChars: 400,
      }).rebuiltPages,
    ).toBe(1);
  });

  it('ignores a previous index from another version', () => {
    const first = buildContentIndex([input('/a', 'x')]);
    const old = { ...first.index, version: INDEX_VERSION + 1 };
    expect(
      buildContentIndex([input('/a', 'x')], { previous: old }).reusedPages,
    ).toBe(0);
  });
});

describe('isContentIndex', () => {
  it('accepts an index and rejects other values', () => {
    const { index } = buildContentIndex([input('/a', 'x')]);
    expect(isContentIndex(index)).toBe(true);
    expect(isContentIndex({ ...index, version: 0 })).toBe(false);
    expect(isContentIndex(null)).toBe(false);
    expect(isContentIndex({})).toBe(false);
  });
});

describe('isIndexable', () => {
  const config = parseConfig({
    name: 'x',
    access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
  });
  it('leaves out hidden pages and pages behind an access rule', () => {
    expect(isIndexable({ path: '/a', hidden: false }, config)).toBe(true);
    expect(isIndexable({ path: '/a', hidden: true }, config)).toBe(false);
    expect(isIndexable({ path: '/private/x', hidden: false }, config)).toBe(
      false,
    );
  });
});
