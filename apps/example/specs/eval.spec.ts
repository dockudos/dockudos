// @vitest-environment node
import {
  type EvalReport,
  type EvalSet,
  evalMetrics,
  evalRegressions,
  embedIndex,
  extractiveLLM,
  KeywordSearch,
  mockEmbeddings,
  parseConfig,
  runEval,
} from '@dockudos/core';
import { buildSiteIndex, discoverPages } from '@dockudos/core/node';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The assistant, measured. Questions with known answers, questions the docs cannot answer, and requests for a place,
// run against the example site with a stand-in model, so the pipeline around the model is what is tested: retrieval,
// prompts, citation checks, refusals. Numbers are compared with eval/baseline.json; a worse number fails the
// build, and citation validity must always be 1. To record better numbers: UPDATE_EVAL_BASELINE=1 pnpm nx test @dockudos/example.

const root = join(import.meta.dirname, '..');
const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(join(root, 'eval', file), 'utf8')) as T;

type Baseline = Record<string, Record<string, number>>;

const limits = {
  maxQuestionLength: 500,
  maxOutputTokens: 800,
  maxHistoryTurns: 6,
  contextTokens: 3000,
};

async function setup(vectors: boolean) {
  const config = parseConfig(
    JSON.parse(await readFile(join(root, 'docs.json'), 'utf8')),
  );
  const tree = await discoverPages(join(root, 'docs'));
  let { index } = await buildSiteIndex({
    root,
    config,
    tree,
    previous: undefined,
  });
  const embeddings = vectors ? mockEmbeddings(256) : undefined;
  if (embeddings) index = (await embedIndex(index, embeddings)).index;
  return { index, embeddings, keyword: new KeywordSearch(index) };
}

const results: Record<
  string,
  { metrics: Record<string, number>; report: EvalReport }
> = {};

describe.each(['keyword', 'hybrid'] as const)(
  'assistant evaluation: %s retrieval',
  (mode) => {
    let report: EvalReport;
    let metrics: Record<string, number>;

    beforeAll(async () => {
      const set = await read<EvalSet>('questions.json');
      const { index, embeddings, keyword } = await setup(mode === 'hybrid');
      report = await runEval(
        {
          siteName: 'Example Docs',
          index,
          keyword,
          embeddings,
          limits,
          llm: extractiveLLM(),
        },
        set,
      );
      metrics = evalMetrics(report);
      results[mode] = { metrics, report };
      const misses = [
        ...report.retrieval.failed.map((id) => `retrieval:${id}`),
        ...report.refusals.failed.map((id) => `refusal:${id}`),
        ...report.navigation.search.failed.map(
          (id) => `navigation-search:${id}`,
        ),
        ...(report.navigation.model?.failed ?? []).map(
          (id) => `navigation-model:${id}`,
        ),
      ];
      if (misses.length)
        console.info(`[eval] ${mode} misses: ${misses.join(', ')}`);
      console.info(
        `[eval] ${mode} ${Object.entries(metrics)
          .map(([k, v]) => `${k}=${v.toFixed(3)}`)
          .join(' ')}`,
      );
    });

    it('every citation names a source the model was given, at a page and heading that exist', () => {
      expect(report.citations.invalid).toBe(0);
      expect(report.citations.validity).toBe(1);
      expect(report.citations.cited).toBeGreaterThan(10);
    });

    it('answers cite their sources', () => {
      expect(report.citations.uncited).toEqual([]);
    });

    // The default setup, with or without a model, takes every request in the set to the right place.
    it.runIf(mode === 'keyword')(
      'navigation lands on the right page and heading for every case',
      () => {
        expect(report.navigation.search.failed).toEqual([]);
        expect(report.navigation.model?.failed).toEqual([]);
      },
    );

    it('does not get worse than the recorded baseline', async () => {
      const baseline = (await read<Baseline>('baseline.json'))[mode] ?? {};
      const problems = evalRegressions(metrics, baseline);
      const failing = [
        ...report.retrieval.failed.map((id) => `retrieval: ${id}`),
        ...report.refusals.failed.map((id) => `refusal: ${id}`),
        ...report.navigation.search.failed.map(
          (id) => `navigation (search): ${id}`,
        ),
        ...(report.navigation.model?.failed ?? []).map(
          (id) => `navigation (model): ${id}`,
        ),
      ];
      if (problems.length)
        console.warn(
          `[eval] ${mode} failing cases:\n  ${failing.join('\n  ')}`,
        );
      expect(problems).toEqual([]);
    });
  },
);

afterAll(async () => {
  // Kept for the CI run to upload, and for comparing one commit with the next.
  const dir = join(root, 'eval', 'results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'latest.json'), JSON.stringify(results, null, 2));

  if (process.env['UPDATE_EVAL_BASELINE']) {
    const file = join(root, 'eval', 'baseline.json');
    const old = JSON.parse(
      await readFile(file, 'utf8').catch(() => '{}'),
    ) as Baseline;
    const next: Baseline = {};
    for (const [mode, { metrics }] of Object.entries(results)) {
      next[mode] = Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          Math.max(v, old[mode]?.[k] ?? 0),
        ]),
      );
    }
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
    console.info('[eval] baseline updated');
  }
});
