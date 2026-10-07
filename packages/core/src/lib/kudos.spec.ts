import { parseKudosLog, summarizeKudos } from './kudos.ts';

const line = (o: object) => JSON.stringify(o);
const at = '2026-01-01T00:00:00.000Z';

describe('parseKudosLog', () => {
  it('reads votes and comments and counts lines it cannot use', () => {
    const text = [
      line({ id: 'a', at, path: '/x', vote: 'up' }),
      '',
      'not json',
      line({ id: 'b', at, path: '/x', vote: 'sideways' }),
      line({ id: 'c', at, path: '/x' }),
      line({ id: 'a', at, path: '/x', comment: 'nice' }),
    ].join('\n');
    const { entries, skipped } = parseKudosLog(text);
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(3);
  });
});

describe('summarizeKudos', () => {
  const entries = parseKudosLog(
    [
      { id: '1', at, path: '/b', vote: 'up' },
      { id: '2', at, path: '/a', vote: 'down' },
      { id: '3', at, path: '/a', vote: 'up' },
      { id: '4', at, path: '/a', vote: 'up' },
      { id: '2', at, path: '/a', comment: 'The example is wrong' },
      { id: 'orphan', at, path: '/c', comment: 'hi' },
    ]
      .map(line)
      .join('\n'),
  ).entries;

  it('totals votes per page, busiest first', () => {
    const s = summarizeKudos(entries);
    expect(s.pages.map((p) => [p.path, p.up, p.down])).toEqual([
      ['/a', 2, 1],
      ['/b', 1, 0],
      ['/c', 0, 0],
    ]);
    expect([s.up, s.down]).toEqual([3, 1]);
  });

  it('attaches each comment to the vote it followed, when that vote is known', () => {
    const s = summarizeKudos(entries);
    expect(s.pages[0]!.comments).toEqual([
      { at, vote: 'down', text: 'The example is wrong' },
    ]);
    expect(s.pages[2]!.comments[0]!.vote).toBeUndefined();
  });

  it('passes the skipped count through', () => {
    expect(summarizeKudos([], 4).skipped).toBe(4);
  });
});
