import {
  type SseEvent,
  normalizeMessages,
  readSse,
  redact,
} from './ai-provider.ts';

const streamOf = (...chunks: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks)
        controller.enqueue(
          typeof c === 'string' ? new TextEncoder().encode(c) : c,
        );
      controller.close();
    },
  });

async function collect(body: ReadableStream<Uint8Array>) {
  const out: SseEvent[] = [];
  for await (const e of readSse(body)) out.push(e);
  return out;
}

describe('readSse', () => {
  it('reads events with names and multi-line data', async () => {
    expect(
      await collect(
        streamOf(
          'event: delta\ndata: {"a":1}\n\ndata: one\ndata: two\n\n: comment\n\n',
        ),
      ),
    ).toEqual([{ event: 'delta', data: '{"a":1}' }, { data: 'one\ntwo' }]);
  });

  it('copes with chunks cut anywhere, CRLF line ends and a missing final blank line', async () => {
    const text = 'data: hello\r\n\r\ndata: wor';
    const chunks = text.match(/[\s\S]{1,3}/g) as string[];
    expect(await collect(streamOf(...chunks, 'ld\r\n'))).toEqual([
      { data: 'hello' },
      { data: 'world' },
    ]);
  });

  it('does not break a character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: héllo €\n\n');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    expect(
      await collect(streamOf(bytes.slice(0, cut), bytes.slice(cut))),
    ).toEqual([{ data: 'héllo €' }]);
  });

  it('ignores events without data', async () => {
    expect(await collect(streamOf('event: ping\n\n'))).toEqual([]);
  });
});

describe('normalizeMessages', () => {
  it('starts with a user message, alternates roles and drops empty turns', () => {
    expect(
      normalizeMessages([
        { role: 'assistant', content: 'stray' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: '  ' },
        { role: 'assistant', content: 'c' },
        { role: 'user', content: 'd' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'd' },
    ]);
  });
});

describe('redact', () => {
  it('removes every secret, everywhere', () => {
    expect(
      redact('key sk-secret-1 and sk-secret-1 again', [
        'sk-secret-1',
        undefined,
      ]),
    ).toBe('key *** and *** again');
    expect(redact('abc', ['abc'])).toBe('abc'); // too short to be a key
  });
});
