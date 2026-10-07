import { chunkSections, splitText } from './chunk.ts';
import { extractPage } from './extract.ts';

const sec = (headingPath: string[], text: string) => ({
  headingPath,
  anchor: headingPath.at(-1)?.toLowerCase() ?? '',
  depth: headingPath.length + 1,
  text,
});

describe('chunkSections', () => {
  it('makes one chunk per section that fits', () => {
    const chunks = chunkSections('/a', [
      sec(['One'], 'First.'),
      sec(['One', 'Two'], 'Second.'),
    ]);
    expect(chunks.map((c) => [c.headingPath, c.anchor, c.text])).toEqual([
      [['One'], 'one', 'First.'],
      [['One', 'Two'], 'two', 'Second.'],
    ]);
    expect(chunks.every((c) => c.pagePath === '/a')).toBe(true);
  });

  it('never exceeds the size cap and keeps heading path and anchor on every part', () => {
    const paragraph = 'word '.repeat(60).trim(); // 299 chars
    const text = Array.from({ length: 12 }, () => paragraph).join('\n\n');
    const chunks = chunkSections('/a', [sec(['Big'], text)], { maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(700);
      expect(c.headingPath).toEqual(['Big']);
      expect(c.anchor).toBe('big');
    }
    // Nothing is lost.
    expect(chunks.map((c) => c.text).join('\n\n')).toBe(text);
  });

  it('cuts a single huge line at word boundaries', () => {
    const line = 'abc '.repeat(500).trim();
    for (const part of splitText(line, 300)) {
      expect(part.length).toBeLessThanOrEqual(300);
      expect(part).not.toMatch(/^\s|\s$/);
    }
  });

  it('cuts inside a word that has no spaces', () => {
    const parts = splitText('x'.repeat(1000), 300);
    expect(parts.map((p) => p.length)).toEqual([300, 300, 300, 100]);
  });

  it('gives stable ids, unique even for identical chunks', () => {
    const a = chunkSections('/a', [sec(['H'], 'Same.')]);
    const b = chunkSections('/a', [sec(['H'], 'Same.')]);
    expect(a[0]?.id).toBe(b[0]?.id);
    const dup = chunkSections('/a', [sec(['H'], 'Same.'), sec(['H'], 'Same.')]);
    expect(new Set(dup.map((c) => c.id)).size).toBe(2);
  });

  it('changes ids with path, heading path or text', () => {
    const base = chunkSections('/a', [sec(['H'], 'Text.')])[0]?.id;
    expect(chunkSections('/b', [sec(['H'], 'Text.')])[0]?.id).not.toBe(base);
    expect(chunkSections('/a', [sec(['G'], 'Text.')])[0]?.id).not.toBe(base);
    expect(chunkSections('/a', [sec(['H'], 'Text!')])[0]?.id).not.toBe(base);
  });

  it('a content change alters only the affected chunks', () => {
    const before = extractPage(
      '## A\n\nalpha\n\n## B\n\nbeta\n\n## C\n\ngamma',
    );
    const after = extractPage(
      '## A\n\nalpha\n\n## B\n\nbeta CHANGED\n\n## C\n\ngamma',
    );
    const ids = (p: typeof before) =>
      chunkSections('/p', p.sections).map((c) => c.id);
    const [a1, b1, c1] = ids(before);
    const [a2, b2, c2] = ids(after);
    expect(a2).toBe(a1);
    expect(c2).toBe(c1);
    expect(b2).not.toBe(b1);
  });

  it('skips sections with no text', () => {
    expect(chunkSections('/a', [sec(['Empty'], '')])).toEqual([]);
  });
});
