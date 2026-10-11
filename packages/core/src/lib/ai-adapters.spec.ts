import {
  type FetchLike,
  anthropicProvider,
  openaiEmbeddings,
  openaiProvider,
} from './ai-adapters.ts';
import { ProviderError } from './ai-provider.ts';

const sse = (...events: string[]) =>
  new Response(events.join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const KEY = 'sk-test-key-123456';

function recorder(respond: (n: number) => Response | Promise<Response>) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length);
  };
  return { calls, fetch };
}

const text = async (stream: AsyncIterable<string>) => {
  let out = '';
  for await (const piece of stream) out += piece;
  return out;
};

describe('openaiProvider', () => {
  const delta = (content: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it('streams the content of each chunk and sends the request OpenAI expects', async () => {
    const { calls, fetch } = recorder(() =>
      sse(delta('Hel'), delta('lo'), delta(null), 'data: [DONE]\n\n'),
    );
    const llm = openaiProvider({ apiKey: KEY, model: 'gpt-x', fetch });
    const out = await text(
      llm.generate({
        system: 'Be brief.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50,
      }),
    );
    expect(out).toBe('Hello');
    const [{ url, init }] = calls as [(typeof calls)[number]];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-x',
      stream: true,
      max_completion_tokens: 50,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
      ],
    });
  });

  it('talks to a compatible server at baseUrl with max_tokens', async () => {
    const { calls, fetch } = recorder(() => sse('data: [DONE]\n\n'));
    const llm = openaiProvider({
      apiKey: KEY,
      model: 'llama',
      baseUrl: 'http://localhost:11434/v1/',
      fetch,
    });
    await text(
      llm.generate({
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 9,
      }),
    );
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(calls[0]?.init.body ?? '{}').max_tokens).toBe(9);
  });

  it('turns an error response into a ProviderError without the key in it', async () => {
    const { fetch } = recorder(
      () =>
        new Response(
          JSON.stringify({ error: { message: `Incorrect API key: ${KEY}` } }),
          { status: 401 },
        ),
    );
    const llm = openaiProvider({ apiKey: KEY, model: 'm', fetch });
    const error = await text(
      llm.generate({ system: 's', messages: [{ role: 'user', content: 'q' }] }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(401);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('reports an error sent in the stream, and an unreachable server', async () => {
    const { fetch } = recorder(() =>
      sse(`data: ${JSON.stringify({ error: { message: `bad ${KEY}` } })}\n\n`),
    );
    const llm = openaiProvider({ apiKey: KEY, model: 'm', fetch });
    await expect(
      text(
        llm.generate({
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
        }),
      ),
    ).rejects.toThrow(/bad \*\*\*/);

    const down = openaiProvider({
      apiKey: KEY,
      model: 'm',
      fetch: async () => {
        throw new Error(`connect ECONNREFUSED (key ${KEY})`);
      },
    });
    const error = await text(
      down.generate({
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
      }),
    ).catch((e: unknown) => e);
    expect((error as Error).message).toContain('could not be reached');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('passes the abort signal on and rethrows an abort as it is', async () => {
    const controller = new AbortController();
    const { calls, fetch } = recorder(() => sse('data: [DONE]\n\n'));
    const llm = openaiProvider({ apiKey: KEY, model: 'm', fetch });
    await text(
      llm.generate({
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        signal: controller.signal,
      }),
    );
    expect(calls[0]?.init.signal).toBe(controller.signal);

    controller.abort();
    const aborting = openaiProvider({
      apiKey: KEY,
      model: 'm',
      fetch: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
    });
    await expect(
      text(
        aborting.generate({
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('anthropicProvider', () => {
  const event = (type: string, body: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;

  it('streams text deltas and sends the Messages API request', async () => {
    const { calls, fetch } = recorder(() =>
      sse(
        event('message_start', { message: {} }),
        event('content_block_delta', {
          delta: { type: 'text_delta', text: 'Hel' },
        }),
        event('content_block_delta', {
          delta: { type: 'input_json_delta', partial_json: '{' },
        }),
        event('content_block_delta', {
          delta: { type: 'text_delta', text: 'lo' },
        }),
        event('message_stop', {}),
      ),
    );
    const llm = anthropicProvider({ apiKey: KEY, model: 'claude-x', fetch });
    const out = await text(
      llm.generate({
        system: 'Be brief.',
        messages: [
          { role: 'assistant', content: 'stray' },
          { role: 'user', content: 'Hi' },
        ],
      }),
    );
    expect(out).toBe('Hello');
    const [{ url, init }] = calls as [(typeof calls)[number]];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe(KEY);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body)).toEqual({
      model: 'claude-x',
      stream: true,
      max_tokens: 1024,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('reports errors from the API and from the stream without the key', async () => {
    const http = anthropicProvider({
      apiKey: KEY,
      model: 'm',
      fetch: async () =>
        new Response('{"error":{"message":"overloaded"}}', { status: 529 }),
    });
    await expect(
      text(
        http.generate({
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
        }),
      ),
    ).rejects.toThrow(/529.*overloaded/);

    const stream = anthropicProvider({
      apiKey: KEY,
      model: 'm',
      fetch: async () =>
        sse(event('error', { error: { message: `no ${KEY}` } })),
    });
    await expect(
      text(
        stream.generate({
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
        }),
      ),
    ).rejects.toThrow('no ***');
  });
});

describe('openaiEmbeddings', () => {
  const vectors = (n: number, dim = 3) =>
    new Response(
      JSON.stringify({
        data: Array.from({ length: n }, (_, index) => ({
          index,
          embedding: Array.from({ length: dim }, (_, d) => index + d / 10),
        })).reverse(), // out of order on purpose
      }),
    );

  it('returns one vector per text, in order, and learns the dimensions', async () => {
    const { calls, fetch } = recorder(() => vectors(3));
    const provider = openaiEmbeddings({
      apiKey: KEY,
      model: 'custom-model',
      fetch,
    });
    expect(provider.dimensions).toBe(0);
    const out = await provider.embed(['a', 'b', 'c']);
    expect(out.map((v) => v[0])).toEqual([0, 1, 2]);
    expect(provider.dimensions).toBe(3);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/embeddings');
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({
      model: 'custom-model',
      input: ['a', 'b', 'c'],
    });
  });

  it('knows the size of the common models and can request shorter vectors', () => {
    expect(
      openaiEmbeddings({ apiKey: KEY, model: 'text-embedding-3-small' })
        .dimensions,
    ).toBe(1536);
    const { calls, fetch } = recorder(() => vectors(1, 8));
    const short = openaiEmbeddings({
      apiKey: KEY,
      model: 'text-embedding-3-small',
      dimensions: 8,
      fetch,
    });
    expect(short.dimensions).toBe(8);
    return short.embed(['x']).then(() => {
      expect(JSON.parse(calls[0]?.init.body ?? '{}').dimensions).toBe(8);
    });
  });

  it('sends large inputs in batches', async () => {
    const { calls, fetch } = recorder((n) => vectors(n === 1 ? 96 : 4));
    const provider = openaiEmbeddings({ apiKey: KEY, model: 'm', fetch });
    const out = await provider.embed(
      Array.from({ length: 100 }, (_, i) => `t${i}`),
    );
    expect(out).toHaveLength(100);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.init.body ?? '{}').input).toHaveLength(4);
  });

  it('retries rate limits and server errors, then gives up', async () => {
    const sleeps: number[] = [];
    const { calls, fetch } = recorder((n) =>
      n < 3 ? new Response('slow down', { status: 429 }) : vectors(1),
    );
    const provider = openaiEmbeddings({
      apiKey: KEY,
      model: 'm',
      fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(await provider.embed(['x'])).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);

    const failing = openaiEmbeddings({
      apiKey: KEY,
      model: 'm',
      fetch: async () => new Response('down', { status: 503 }),
      sleep: async () => undefined,
    });
    await expect(failing.embed(['x'])).rejects.toThrow('503');
  });

  it('does not retry a rejected key, and rejects a mismatched response', async () => {
    const { calls, fetch } = recorder(
      () => new Response('{}', { status: 401 }),
    );
    const provider = openaiEmbeddings({
      apiKey: KEY,
      model: 'm',
      fetch,
      sleep: async () => undefined,
    });
    await expect(provider.embed(['x'])).rejects.toThrow('401');
    expect(calls).toHaveLength(1);

    const short = openaiEmbeddings({
      apiKey: KEY,
      model: 'm',
      fetch: async () => vectors(1),
    });
    await expect(short.embed(['a', 'b'])).rejects.toThrow('did not match');
  });
});

describe('adapters: the platform fetch, bodies and chunks that are not usable', () => {
  afterEach(() => vi.unstubAllGlobals());
  const generate = (llm: ReturnType<typeof openaiProvider>) =>
    text(
      llm.generate({
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 5,
      }),
    );

  it('uses the global fetch when none is given', async () => {
    const fetchMock = vi.fn(async () =>
      sse(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await generate(openaiProvider({ apiKey: KEY, model: 'm' }))).toBe(
      'ok',
    );
    fetchMock.mockImplementation(async () =>
      sse(
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })}\n\n`,
      ),
    );
    expect(await generate(anthropicProvider({ apiKey: KEY, model: 'm' }))).toBe(
      'hi',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says so when the answer has no body', async () => {
    const noBody = { ok: true, status: 200, body: null } as unknown as Response;
    const { fetch } = recorder(() => noBody);
    await expect(
      generate(openaiProvider({ apiKey: KEY, model: 'm', fetch })),
    ).rejects.toThrow('no response body');
    await expect(
      generate(anthropicProvider({ apiKey: KEY, model: 'm', fetch })),
    ).rejects.toThrow('no response body');
  });

  it('skips events that are not JSON', async () => {
    const good = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`;
    const { fetch } = recorder(() =>
      sse('data: {oops\n\n', good, 'data: [DONE]\n\n'),
    );
    expect(
      await generate(openaiProvider({ apiKey: KEY, model: 'm', fetch })),
    ).toBe('x');
    const anth = recorder(() =>
      sse(
        'event: ping\ndata: {oops\n\n',
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'y' } })}\n\n`,
      ),
    );
    expect(
      await generate(
        anthropicProvider({ apiKey: KEY, model: 'm', fetch: anth.fetch }),
      ),
    ).toBe('y');
  });
});

describe('openaiEmbeddings: the platform fetch and the real pause between retries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the global fetch, and waits before it tries again', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++n === 1
          ? new Response('busy', { status: 429 })
          : Response.json({ data: [{ index: 0, embedding: [1, 2] }] }),
      ),
    );
    const embeddings = openaiEmbeddings({
      apiKey: KEY,
      model: 'm',
      retryDelay: 1,
    });
    expect(await embeddings.embed(['a'])).toEqual([[1, 2]]);
    expect(n).toBe(2);
  });
});
