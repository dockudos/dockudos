import { buildContentIndex } from './content-index.ts';
import { KeywordSearch } from './keyword-search.ts';

// Budget from notes/architecture.md section 10: palette search under 100 ms on a 1,000-page site.
const PAGES = 1000;
const BUDGET_MS = 100;

/** Small deterministic generator, so the corpus is the same on every run. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const VOCABULARY = Array.from({ length: 4000 }, (_, i) => {
  const syllables = [
    'ka',
    'lo',
    'mi',
    'ne',
    'ru',
    'sta',
    'ven',
    'tor',
    'ex',
    'pa',
  ];
  let w = '';
  for (let n = i + 7, k = 0; k < 3 + (i % 3); k++, n = Math.floor(n / 7) + i)
    w += syllables[n % syllables.length];
  return `${w}${i % 11 === 0 ? 'ion' : ''}`;
});

function corpus() {
  const rnd = random(42);
  const word = () =>
    VOCABULARY[Math.floor(rnd() ** 2 * VOCABULARY.length)] as string;
  const sentence = () =>
    Array.from({ length: 12 }, word)
      .join(' ')
      .replace(/^./, (c) => c.toUpperCase()) + '.';
  return Array.from({ length: PAGES }, (_, p) => ({
    path: `/section-${p % 20}/page-${p}`,
    title: `${word()} ${word()} ${p}`,
    description: sentence(),
    body: Array.from(
      { length: 6 },
      (_, s) =>
        `## ${word()} ${word()}\n\n${Array.from({ length: 6 }, sentence).join(' ')}\n`,
    ).join('\n'),
  }));
}

describe('search latency on a 1,000-page corpus', () => {
  it(`answers every query in under ${BUDGET_MS} ms`, () => {
    const { index } = buildContentIndex(corpus());
    expect(index.pages).toHaveLength(PAGES);
    expect(index.chunks.length).toBeGreaterThan(PAGES * 4);

    const buildStart = performance.now();
    const engine = new KeywordSearch(index);
    const buildMs = performance.now() - buildStart;

    const rnd = random(7);
    const queries = [
      ...Array.from({ length: 40 }, () =>
        [
          VOCABULARY[Math.floor(rnd() * 500)],
          VOCABULARY[Math.floor(rnd() * 500)],
        ].join(' '),
      ),
      'kalomi', // prefix of many terms
      'zzzzqqqq', // unknown: goes through the typo search
      'how do i configure the kalomine pasta',
    ];
    engine.search('warm up');

    const times = queries.map((q) => {
      const t = performance.now();
      engine.search(q, { limit: 10, maxPerPage: 2 });
      return performance.now() - t;
    });
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    const worst = times.at(-1) as number;
    // One line per run, so CI logs show the trend per commit.
    console.info(
      `[benchmark] pages=${PAGES} chunks=${index.chunks.length} engine-build=${buildMs.toFixed(0)}ms query-p95=${p95.toFixed(1)}ms query-max=${worst.toFixed(1)}ms`,
    );
    expect(worst).toBeLessThan(BUDGET_MS);
  });
});
