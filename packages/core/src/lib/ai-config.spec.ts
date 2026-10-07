import { AI_ENV, resolveAiProviders } from './ai-config.ts';
import { mockEmbeddings, mockLLM } from './ai-mock.ts';
import { parseConfig } from './config.ts';

const ai = (extra: object = {}) =>
  parseConfig({
    name: 'A',
    ai: { enabled: true, provider: 'openai', model: 'gpt-x', ...extra },
  }).ai;

describe('resolveAiProviders', () => {
  it('does nothing when AI is off, even with keys set', () => {
    const off = parseConfig({ name: 'A' }).ai;
    expect(
      resolveAiProviders(off, { env: { [AI_ENV.llmKey]: 'sk-123456' } }),
    ).toEqual({
      problems: [],
    });
  });

  it('builds the model the config names from the environment key', () => {
    const openai = resolveAiProviders(ai(), {
      env: { [AI_ENV.llmKey]: 'sk-123456' },
    });
    expect(openai.llm?.id).toBe('openai');
    expect(openai.problems).toEqual([]);
    const claude = resolveAiProviders(
      ai({ provider: 'anthropic', model: 'c' }),
      {
        env: { [AI_ENV.llmKey]: 'sk-123456' },
      },
    );
    expect(claude.llm?.id).toBe('anthropic');
  });

  it('says which variable to set when the key is missing', () => {
    const r = resolveAiProviders(ai(), { env: {} });
    expect(r.llm).toBeUndefined();
    expect(r.problems).toEqual([
      'Set the DOCKUDOS_LLM_API_KEY environment variable to use the openai model.',
    ]);
  });

  it('uses an adapter passed in code, and needs one for "custom"', () => {
    const mine = mockLLM();
    expect(
      resolveAiProviders(ai({ provider: 'custom' }), { env: {}, llm: mine })
        .llm,
    ).toBe(mine);
    const missing = resolveAiProviders(ai({ provider: 'custom' }), { env: {} });
    expect(missing.problems[0]).toContain('no adapter was given');
  });

  it('reads the embeddings key from its own variable, or shares the OpenAI key', () => {
    const cfg = ai({ embeddings: { model: 'text-embedding-3-small' } });
    expect(
      resolveAiProviders(cfg, {
        env: {
          [AI_ENV.llmKey]: 'sk-llm-1234',
          [AI_ENV.embeddingsKey]: 'sk-emb-1234',
        },
      }).embeddings?.model,
    ).toBe('text-embedding-3-small');
    expect(
      resolveAiProviders(cfg, { env: { [AI_ENV.llmKey]: 'sk-llm-1234' } })
        .embeddings,
    ).toBeDefined();
  });

  it('does not send the model key to a different embeddings server', () => {
    const cfg = ai({
      embeddings: { model: 'm', baseUrl: 'https://other.example.com/v1' },
    });
    const r = resolveAiProviders(cfg, {
      env: { [AI_ENV.llmKey]: 'sk-llm-1234' },
    });
    expect(r.embeddings).toBeUndefined();
    expect(r.problems).toEqual([
      expect.stringContaining('DOCKUDOS_EMBEDDINGS_API_KEY'),
    ]);
    expect(r.llm).toBeDefined(); // the answer feature still works
  });

  it('never puts a key in a problem message', () => {
    const r = resolveAiProviders(ai({ embeddings: { model: 'm' } }), {
      env: { [AI_ENV.llmKey]: 'sk-secret-value' },
    });
    expect(JSON.stringify(r.problems)).not.toContain('sk-secret-value');
  });
});

describe('mocks', () => {
  it('streams a scripted answer word by word and records the calls', async () => {
    const llm = mockLLM(() => 'one two  three');
    let out = '';
    const pieces: string[] = [];
    for await (const p of llm.generate({
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
    })) {
      pieces.push(p);
      out += p;
    }
    expect(out).toBe('one two  three');
    expect(pieces.length).toBe(3);
    expect(llm.calls).toHaveLength(1);
  });

  it('stops streaming when aborted', async () => {
    const controller = new AbortController();
    const llm = mockLLM(() => 'a b c d');
    const seen: string[] = [];
    for await (const p of llm.generate({
      system: 's',
      messages: [],
      signal: controller.signal,
    })) {
      seen.push(p);
      controller.abort();
    }
    expect(seen).toEqual(['a ']);
  });

  it('embeds texts into unit vectors where shared words mean similarity', async () => {
    const e = mockEmbeddings(128);
    const [a, b, c] = await e.embed([
      'rotate the api key every ninety days',
      'rotate api keys regularly',
      'invoices are sent monthly',
    ]);
    const cos = (x: number[], y: number[]) =>
      x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(cos(a as number[], a as number[])).toBeCloseTo(1);
    expect(cos(a as number[], b as number[])).toBeGreaterThan(
      cos(a as number[], c as number[]),
    );
    expect(e.dimensions).toBe(128);
    expect(await e.embed(['same'])).toEqual(await e.embed(['same']));
  });
});
