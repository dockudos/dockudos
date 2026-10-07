import { type AskEvent, mockLLM, parseExcerpts } from '@dockudos/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocsApi } from './api.ts';

let root: string;
let cwd: string;

const ctx = (...segments: string[]) => ({
  params: Promise.resolve({ dockudos: segments }),
});

function post(
  body: unknown,
  headers: Record<string, string> = {},
  raw?: string,
) {
  return new Request('http://docs.test/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

async function events(response: Response): Promise<AskEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data: /, '')) as AskEvent);
}

/** Answers from the first excerpt and cites it. */
const citing = () =>
  mockLLM((input) => {
    const first = parseExcerpts(input.messages.at(-1)?.content ?? '')[0];
    return `${first?.text} [1]`;
  });

async function writeSite(ai: object | null = {}) {
  await writeFile(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      ...(ai && {
        ai: {
          enabled: true,
          provider: 'custom',
          limits: { ratePerMinute: 2, maxQuestionLength: 100 },
          ...ai,
        },
      }),
    }),
  );
}

beforeEach(async () => {
  cwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'dockudos-ask-'));
  await mkdir(join(root, 'docs', 'guides'), { recursive: true });
  await writeFile(
    join(root, 'docs', 'guides', 'auth.mdx'),
    '---\ntitle: Authentication\n---\n\n## API keys\n\nRotate a key every ninety days.\n',
  );
  await writeSite();
  process.chdir(root);
});
afterEach(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('POST /api/ask', () => {
  it('answers 404 with a hint when the assistant is not enabled', async () => {
    await writeSite(null);
    const api = createDocsApi({ ai: { llm: citing() } });
    const res = await api.POST(
      post({ question: 'How do I rotate a key?' }),
      ctx('ask'),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('ai.enabled');
  });

  it('streams sources, the answer and done as server-sent events', async () => {
    const llm = citing();
    const api = createDocsApi({ ai: { llm } });
    const res = await api.POST(
      post({ question: 'How do I rotate a key?' }),
      ctx('ask'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const list = await events(res);
    expect(list.map((e) => e.type)).toEqual([
      'sources',
      ...Array(list.length - 2).fill('token'),
      'done',
    ]);
    expect(list[0]).toMatchObject({
      items: [{ n: 1, url: '/guides/auth#api-keys', title: 'Authentication' }],
    });
    expect(list.at(-1)).toEqual({ type: 'done', citations: [1] });
    expect(llm.calls[0]?.maxTokens).toBe(800);
  });

  it('refuses a question nothing in the docs relates to, without calling the model', async () => {
    const llm = citing();
    const api = createDocsApi({ ai: { llm } });
    const list = await events(
      await api.POST(
        post({ question: 'What is the capital of Australia?' }),
        ctx('ask'),
      ),
    );
    expect(llm.calls).toHaveLength(0);
    expect(list.at(-1)).toMatchObject({ type: 'done', refused: 'no-context' });
  });

  it('rejects bad requests with a status and a message, not a crash', async () => {
    await writeSite({
      limits: { ratePerMinute: 100, maxQuestionLength: 100 },
    });
    const api = createDocsApi({ ai: { llm: citing() } });
    const bad = async (request: Request) => {
      const res = await api.POST(request, ctx('ask'));
      return [res.status, (await res.json()).error] as const;
    };
    expect(await bad(post(null, {}, '{nope'))).toEqual([
      400,
      'The request body is not valid JSON.',
    ]);
    expect(await bad(post({ question: '' }))).toEqual([400, 'Ask a question.']);
    expect(await bad(post({ question: 'x'.repeat(101) }))).toEqual([
      413,
      'The question is longer than 100 characters.',
    ]);
    expect(await bad(post({ question: 'q', history: 5 }))).toEqual([
      400,
      '"history" must be a list of messages.',
    ]);
    expect(await bad(post({ question: 'q', pad: 'x'.repeat(40_000) }))).toEqual(
      [413, 'The request is too large.'],
    );
    const declared = post({ question: 'q' }, { 'content-length': '999999' });
    expect(await bad(declared)).toEqual([413, 'The request is too large.']);
  });

  it('limits each visitor per minute, with Retry-After, and counts visitors separately', async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    const ask = (ip: string) =>
      api.POST(
        post({ question: 'How do I rotate a key?' }, { 'x-forwarded-for': ip }),
        ctx('ask'),
      );
    expect((await ask('1.1.1.1')).status).toBe(200);
    expect((await ask('1.1.1.1')).status).toBe(200);
    const limited = await ask('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(
      /Too many questions\. Try again in \d+ seconds\./,
    );
    expect((await ask('2.2.2.2')).status).toBe(200);
  });

  it('answers a repeated question from memory, but not a follow-up', async () => {
    await writeSite({ limits: { ratePerMinute: 50 } });
    const llm = citing();
    const api = createDocsApi({ ai: { llm } });
    const q = { question: 'How do I rotate a key?' };
    const first = await events(await api.POST(post(q), ctx('ask')));
    const again = await events(
      await api.POST(
        post({ question: '  how do I ROTATE a key? ' }),
        ctx('ask'),
      ),
    );
    expect(llm.calls).toHaveLength(1);
    expect(again.at(-1)).toEqual(first.at(-1));
    expect(again.map((e) => e.type)).toEqual(['sources', 'token', 'done']);

    const followUp = await api.POST(
      post({
        ...q,
        history: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      }),
      ctx('ask'),
    );
    expect(followUp.status).toBe(200);
    await events(followUp);
    expect(llm.calls).toHaveLength(2);
  });

  it('without a key, offers related pages and says so once in the log', async () => {
    await writeSite({ provider: 'openai', model: 'gpt-x' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = createDocsApi({ ai: { env: {} } });
    const list = await events(
      await api.POST(post({ question: 'How do I rotate a key?' }), ctx('ask')),
    );
    await api.POST(post({ question: 'rotate a key again please' }), ctx('ask'));
    expect(list.at(-1)).toMatchObject({
      refused: 'no-llm',
      related: [{ url: '/guides/auth#api-keys' }],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('DOCKUDOS_LLM_API_KEY');
    warn.mockRestore();
  });

  it('only POST is accepted', async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    expect(
      (await api.GET(new Request('http://docs.test/api/ask'), ctx('ask')))
        .status,
    ).toBe(404);
  });

  it('stops asking the model when the reader goes away', async () => {
    const llm = mockLLM(
      () => Array.from({ length: 200 }, (_, i) => `word${i} `).join('') + '[1]',
    );
    const api = createDocsApi({ ai: { llm } });
    const res = await api.POST(
      post({ question: 'How do I rotate a key?' }),
      ctx('ask'),
    );
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});

describe('POST /api/navigate', () => {
  const nav = (
    body: unknown,
    headers: Record<string, string> = {},
    raw?: string,
  ) =>
    new Request('http://docs.test/api/navigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: raw ?? JSON.stringify(body),
    });

  it('finds the section for a request without any model key, saying why', async () => {
    await writeSite({
      provider: 'openai',
      model: 'gpt-x',
      limits: { ratePerMinute: 50 },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = createDocsApi({ ai: { env: {} } });
    const res = await api.POST(
      nav({ query: 'rotate my key' }),
      ctx('navigate'),
    );
    warn.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      path: '/guides/auth',
      anchor: 'api-keys',
      url: '/guides/auth#api-keys',
      title: 'Authentication',
      headingPath: ['API keys'],
      confidence: 'high',
      ranked: 'search',
      reason: expect.stringContaining('Authentication › API keys'),
    });
  });

  it('lets the model choose when there is one, and remembers the answer', async () => {
    await writeSite({ limits: { ratePerMinute: 50 } });
    const llm = mockLLM(
      () =>
        '{"choice": 1, "confidence": "high", "reason": "This section explains rotating keys."}',
    );
    const api = createDocsApi({ ai: { llm } });
    const first = await (
      await api.POST(nav({ query: 'rotate my key' }), ctx('navigate'))
    ).json();
    expect(first).toMatchObject({
      ranked: 'model',
      reason: 'This section explains rotating keys.',
    });
    await api.POST(nav({ query: '  Rotate my   KEY ' }), ctx('navigate'));
    expect(llm.calls).toHaveLength(1);
  });

  it('answers 404 when the docs have nothing on it, and when navigation is off', async () => {
    await writeSite({ limits: { ratePerMinute: 50 } });
    const api = createDocsApi({ ai: { llm: mockLLM() } });
    const none = await api.POST(
      nav({ query: 'quantum teleportation of llamas' }),
      ctx('navigate'),
    );
    expect(none.status).toBe(404);
    expect((await none.json()).error).toBe('Nothing in the docs matches that.');

    await writeSite({ navigation: false });
    const off = await createDocsApi({ ai: { llm: mockLLM() } }).POST(
      nav({ query: 'rotate my key' }),
      ctx('navigate'),
    );
    expect(off.status).toBe(404);
    await writeSite(null);
    const disabled = await createDocsApi().POST(
      nav({ query: 'rotate my key' }),
      ctx('navigate'),
    );
    expect(disabled.status).toBe(404);
  });

  it('rejects bad requests with a message', async () => {
    await writeSite({ limits: { ratePerMinute: 100, maxQuestionLength: 100 } });
    const api = createDocsApi({ ai: { llm: mockLLM() } });
    const bad = async (request: Request) => {
      const res = await api.POST(request, ctx('navigate'));
      return [res.status, (await res.json()).error] as const;
    };
    expect(await bad(nav(null, {}, '{nope'))).toEqual([
      400,
      'The request body is not valid JSON.',
    ]);
    expect(await bad(nav({}))).toEqual([400, 'Say where you want to go.']);
    expect(await bad(nav({ query: 'x'.repeat(101) }))).toEqual([
      413,
      'The request is longer than 100 characters.',
    ]);
    expect(await bad(nav({ query: 'q', pad: 'x'.repeat(40_000) }))).toEqual([
      413,
      'The request is too large.',
    ]);
  });

  it('shares the visitor’s budget with the assistant', async () => {
    const api = createDocsApi({ ai: { llm: citing() } });
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    expect(
      (
        await api.POST(
          post({ question: 'How do I rotate a key?' }, ip),
          ctx('ask'),
        )
      ).status,
    ).toBe(200);
    expect(
      (await api.POST(nav({ query: 'rotate my key' }, ip), ctx('navigate')))
        .status,
    ).toBe(200);
    const limited = await api.POST(
      nav({ query: 'rotate my key please' }, ip),
      ctx('navigate'),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});
