import { CLIENT_LIMITS } from './client.ts';
import {
  EXAMPLE_LIMITS,
  diffLines,
  makeExample,
  migrateResponseExample,
} from './client-response.ts';

describe('keeping a response', () => {
  it('keeps what came back, named after the status when there is no name', () => {
    const example = makeExample({
      requestId: 'r1',
      name: '  ',
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: '{"a":1}',
    });
    expect(example).toMatchObject({
      requestId: 'r1',
      name: '200',
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: '{"a":1}',
      v: 1,
    });
    expect(example.truncated).toBeUndefined();
    expect(example.at).toBeGreaterThan(0);
  });

  it('cuts a long body and says it did', () => {
    const example = makeExample({
      name: 'Big',
      status: 200,
      body: 'x'.repeat(EXAMPLE_LIMITS.bodyLength + 1),
    });
    expect(example.body).toHaveLength(EXAMPLE_LIMITS.bodyLength);
    expect(example.truncated).toBe(true);
  });

  it('cuts a long name and too many headers', () => {
    const example = makeExample({
      name: 'n'.repeat(500),
      status: 200,
      headers: Array.from({ length: CLIENT_LIMITS.headers + 5 }, (_, i) => [`h${i}`, 'v']),
      body: '',
    });
    expect(example.name).toHaveLength(CLIENT_LIMITS.nameLength);
    expect(example.headers).toHaveLength(CLIENT_LIMITS.headers);
  });

  it('reads one back, filling in what is missing', () => {
    expect(
      migrateResponseExample({ status: 404, headers: [['a', 'b'], ['c'], 7], body: 'x' }),
    ).toMatchObject({
      name: '404',
      status: 404,
      headers: [
        ['a', 'b'],
        ['c', ''],
      ],
      body: 'x',
    });
    expect(
      migrateResponseExample({
        id: 'e1',
        requestId: 'r1',
        name: 'Not found',
        at: 5,
        status: 404,
        statusText: 'Not Found',
        truncated: true,
      }),
    ).toEqual({
      id: 'e1',
      requestId: 'r1',
      name: 'Not found',
      at: 5,
      status: 404,
      statusText: 'Not Found',
      headers: [],
      body: '',
      truncated: true,
      v: 1,
    });
  });

  it('refuses what it cannot read and leaves a newer record alone', () => {
    expect(migrateResponseExample(null)).toBeUndefined();
    expect(migrateResponseExample({ body: 'x' })).toBeUndefined();
    expect(migrateResponseExample({ status: 200, v: 99 })).toBeUndefined();
  });
});

describe('comparing two responses', () => {
  it('marks what was added and what went', () => {
    const diff = diffLines('a\nb\nc', 'a\nc\nd');
    expect(diff.lines).toEqual([
      { mark: 'same', text: 'a', left: 1, right: 1 },
      { mark: 'removed', text: 'b', left: 2 },
      { mark: 'same', text: 'c', left: 3, right: 2 },
      { mark: 'added', text: 'd', right: 3 },
    ]);
    expect(diff).toMatchObject({ added: 1, removed: 1 });
  });

  it('says nothing changed when nothing did', () => {
    const diff = diffLines('{\n  "a": 1\n}', '{\n  "a": 1\n}');
    expect(diff.added + diff.removed).toBe(0);
    expect(diff.lines.every((l) => l.mark === 'same')).toBe(true);
  });

  it('handles a side that is empty', () => {
    expect(diffLines('', 'a\nb')).toMatchObject({ added: 2, removed: 1 });
    expect(diffLines('a\nb', '')).toMatchObject({ added: 1, removed: 2 });
  });

  it('refuses a comparison that would take too long, instead of freezing the page', () => {
    const long = Array.from({ length: EXAMPLE_LIMITS.diffLines + 1 }, (_, i) => `${i}`).join('\n');
    expect(diffLines(long, 'a')).toEqual({ lines: [], added: 0, removed: 0, tooLong: true });
    expect(diffLines('a', long).tooLong).toBe(true);
  });
});
