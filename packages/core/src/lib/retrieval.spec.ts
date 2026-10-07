import { mockEmbeddings } from './ai-mock.ts';
import type { EmbeddingProvider } from './ai-provider.ts';
import { buildContentIndex } from './content-index.ts';
import { embedIndex, embeddingText } from './embed-index.ts';
import { KeywordSearch } from './keyword-search.ts';
import { cosine, reciprocalRankFusion, retrieve } from './retrieval.ts';

describe('reciprocalRankFusion', () => {
  const id = (s: string) => s;

  it('ranks items near the top of several lists first', () => {
    const fused = reciprocalRankFusion(
      [
        ['a', 'b', 'c'],
        ['c', 'b', 'd'],
      ],
      id,
    );
    expect(fused.map((f) => f.item)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('scores by 1/(k+rank) summed over the lists', () => {
    const [top] = reciprocalRankFusion([['x'], ['x']], id, 60);
    expect(top?.score).toBeCloseTo(2 / 61);
    expect(top?.found).toEqual([0, 1]);
  });

  it('keeps the first list’s order for ties, and handles empty lists', () => {
    expect(reciprocalRankFusion([['a'], ['b']], id).map((f) => f.item)).toEqual(
      ['a', 'b'],
    );
    expect(reciprocalRankFusion([[], ['a']], id).map((f) => f.item)).toEqual([
      'a',
    ]);
    expect(reciprocalRankFusion<string>([], id)).toEqual([]);
  });

  it('only the first list matching means keyword-only order is preserved', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c']], id);
    expect(fused.map((f) => f.item)).toEqual(['a', 'b', 'c']);
  });
});

describe('cosine', () => {
  it('is 1 for equal directions, 0 for orthogonal, and safe for zero vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

const pages = [
  {
    path: '/auth',
    title: 'Authentication',
    body: '## Rotate keys\n\nCreate a new credential and retire the old secret every ninety days.\n\n## Errors\n\nA bad credential returns 401.',
  },
  {
    path: '/billing',
    title: 'Billing',
    body: '## Invoices\n\nInvoices are emailed monthly to the account owner.',
  },
  {
    path: '/limits',
    title: 'Limits',
    body: '## Rate limits\n\nEach account may send sixty requests per minute.',
  },
];

async function setup(withVectors = true) {
  const embeddings = mockEmbeddings(256);
  let { index } = buildContentIndex(pages);
  if (withVectors) index = (await embedIndex(index, embeddings)).index;
  return { index, embeddings, keyword: new KeywordSearch(index) };
}

describe('retrieve', () => {
  it('uses keywords alone without embeddings', async () => {
    const { index, keyword } = await setup(false);
    const r = await retrieve('invoices monthly', index, keyword);
    expect(r.mode).toBe('keyword');
    expect(r.chunks[0]?.page.path).toBe('/billing');
    expect(r.chunks[0]?.via).toEqual(['keyword']);
  });

  it('falls back to keywords when the index has no vectors, or vectors of another model', async () => {
    const { index, keyword, embeddings } = await setup(false);
    expect(
      (await retrieve('invoices', index, keyword, { embeddings })).mode,
    ).toBe('keyword');

    const full = await setup(true);
    const other: EmbeddingProvider = {
      ...full.embeddings,
      model: 'another-model',
    };
    expect(
      (
        await retrieve('invoices', full.index, full.keyword, {
          embeddings: other,
        })
      ).mode,
    ).toBe('keyword');
  });

  it('merges keyword and vector rankings', async () => {
    const { index, keyword, embeddings } = await setup();
    const r = await retrieve('retire old credential secret', index, keyword, {
      embeddings,
      limit: 3,
    });
    expect(r.mode).toBe('hybrid');
    expect(r.chunks[0]?.chunk.headingPath).toEqual(['Rotate keys']);
    expect(r.chunks[0]?.via.sort()).toEqual(['keyword', 'vector']);
    expect(r.chunks[0]?.similarity).toBeGreaterThan(0.25);
  });

  it('finds a chunk by meaning when no keyword matches', async () => {
    const { index, keyword, embeddings } = await setup();
    // "credential" is in the text, but the query uses none of the words the keyword engine would match.
    const only = await retrieve('zzz', index, keyword, { embeddings });
    expect(only.chunks).toEqual([]);
  });

  it('applies the filter to keyword and vector candidates alike', async () => {
    const { index, keyword, embeddings } = await setup();
    const r = await retrieve('credential invoices requests', index, keyword, {
      embeddings,
      filter: (_chunk, page) => page.path !== '/billing',
    });
    expect(r.chunks.every((c) => c.page.path !== '/billing')).toBe(true);
    expect(r.chunks.length).toBeGreaterThan(0);
  });

  it('answers from keywords when embedding the query fails, and says why', async () => {
    const { index, keyword, embeddings } = await setup();
    const failing: EmbeddingProvider = {
      ...embeddings,
      embed: async () => {
        throw new Error('quota exceeded');
      },
    };
    const r = await retrieve('invoices', index, keyword, {
      embeddings: failing,
    });
    expect(r.mode).toBe('keyword');
    expect(r.vectorError).toBe('quota exceeded');
    expect(r.chunks[0]?.page.path).toBe('/billing');
  });

  it('rethrows an abort instead of hiding it', async () => {
    const { index, keyword, embeddings } = await setup();
    const controller = new AbortController();
    controller.abort();
    const aborting: EmbeddingProvider = {
      ...embeddings,
      embed: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
    };
    await expect(
      retrieve('invoices', index, keyword, {
        embeddings: aborting,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports keyword coverage so weak matches can be recognised', async () => {
    const { index, keyword } = await setup(false);
    const strong = await retrieve('invoices monthly', index, keyword);
    const weak = await retrieve('invoices dragons spaceship', index, keyword);
    expect(strong.chunks[0]?.coverage).toBe(1);
    expect(weak.chunks[0]?.coverage).toBeCloseTo(1 / 3);
  });
});

describe('embedIndex', () => {
  const counting = (dimensions = 32) => {
    const inner = mockEmbeddings(dimensions);
    const seen: string[] = [];
    const provider: EmbeddingProvider = {
      ...inner,
      embed: async (texts, options) => {
        seen.push(...texts);
        return inner.embed(texts, options);
      },
    };
    return { provider, seen };
  };

  it('embeds the title and heading path with the text, and records the model', async () => {
    const { provider, seen } = counting();
    const { index: built } = buildContentIndex(pages);
    const { index, embedded, reused } = await embedIndex(built, provider);
    expect(embedded).toBe(built.chunks.length);
    expect(reused).toBe(0);
    expect(index.embeddings).toEqual({
      provider: 'mock',
      model: 'mock-32',
      dimensions: 32,
    });
    expect(index.chunks.every((c) => c.vector?.length === 32)).toBe(true);
    const page = built.pages[0];
    const chunk = built.chunks[0];
    expect(seen).toContain(embeddingText(page!, chunk!));
    expect(
      embeddingText({ title: 'T' }, { headingPath: ['A', 'B'], text: 'x' }),
    ).toBe('T > A > B\n\nx');
  });

  it('hits the cache for unchanged chunks and embeds only what changed', async () => {
    const first = counting();
    const { index: built } = buildContentIndex(pages);
    const done = await embedIndex(built, first.provider);

    const changed = pages.map((p) =>
      p.path === '/billing'
        ? { ...p, body: '## Invoices\n\nInvoices arrive weekly.' }
        : p,
    );
    const second = counting();
    const { index: rebuilt } = buildContentIndex(changed, {
      previous: done.index,
    });
    const again = await embedIndex(rebuilt, second.provider, {
      previous: done.index,
    });
    expect(second.seen).toHaveLength(1);
    expect(second.seen[0]).toContain('weekly');
    expect(again.embedded).toBe(1);
    expect(again.reused).toBe(rebuilt.chunks.length - 1);
    expect(again.index.chunks.every((c) => c.vector)).toBe(true);
  });

  it('invalidates everything when the model changes', async () => {
    const { index: built } = buildContentIndex(pages);
    const a = await embedIndex(built, counting(32).provider);
    const b = counting(48);
    const out = await embedIndex(a.index, b.provider, { previous: a.index });
    expect(out.reused).toBe(0);
    expect(out.embedded).toBe(built.chunks.length);
    expect(out.index.embeddings?.dimensions).toBe(48);
    expect(out.index.chunks.every((c) => c.vector?.length === 48)).toBe(true);
  });

  it('embeds identical texts once and sends big inputs in batches', async () => {
    const { provider, seen } = counting();
    const same = Array.from({ length: 5 }, (_, i) => ({
      path: `/p${i}`,
      title: 'Same',
      body: 'identical text',
    }));
    const { index: built } = buildContentIndex(same);
    const out = await embedIndex(built, provider, { batchSize: 2 });
    expect(seen).toHaveLength(1);
    expect(out.index.chunks).toHaveLength(5);
    expect(out.index.chunks.every((c) => c.vector)).toBe(true);
  });

  it('rejects a provider that returns the wrong number of vectors', async () => {
    const { index: built } = buildContentIndex(pages);
    const broken: EmbeddingProvider = {
      ...mockEmbeddings(8),
      embed: async () => [],
    };
    await expect(embedIndex(built, broken)).rejects.toThrow('wrong number');
  });
});
