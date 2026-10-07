// @vitest-environment node
import {
  type EvalSet,
  evalMetrics,
  KeywordSearch,
  parseConfig,
  resolveAiProviders,
  runEval,
} from '@dockudos/core';
import { buildSiteIndex, discoverPages } from '@dockudos/core/node';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The same evaluation with a real model, for people to run by hand or nightly (.github/workflows/eval-live.yml).
// It needs a key and costs money, so it is skipped unless DOCKUDOS_EVAL_LIVE=1, and it never runs for a pull request.
//
//   DOCKUDOS_EVAL_LIVE=1 EVAL_PROVIDER=anthropic EVAL_MODEL=<model> DOCKUDOS_LLM_API_KEY=... pnpm nx test @dockudos/example
//
// Only citation validity is required to be 1. The other numbers are recorded in eval/results/live.json to see how a model
// does and to compare models or prompts; they do not fail the run.

const live = process.env['DOCKUDOS_EVAL_LIVE'] === '1';
const root = join(import.meta.dirname, '..');

describe.runIf(live)('assistant evaluation with a real model', () => {
  it('records how the model does, and every citation is valid', async () => {
    const provider = process.env['EVAL_PROVIDER'];
    const model = process.env['EVAL_MODEL'];
    if ((provider !== 'openai' && provider !== 'anthropic') || !model)
      throw new Error(
        'Set EVAL_PROVIDER (openai or anthropic) and EVAL_MODEL.',
      );

    const config = parseConfig(
      JSON.parse(await readFile(join(root, 'docs.json'), 'utf8')),
    );
    const ai = parseConfig({
      name: 'Example Docs',
      ai: {
        enabled: true,
        provider,
        model,
        ...(process.env['EVAL_BASE_URL'] && {
          baseUrl: process.env['EVAL_BASE_URL'],
        }),
      },
    }).ai;
    const resolved = resolveAiProviders(ai, { env: process.env });
    if (!resolved.llm) throw new Error(resolved.problems.join(' '));

    const tree = await discoverPages(join(root, 'docs'));
    const { index } = await buildSiteIndex({
      root,
      config,
      tree,
      previous: undefined,
    });
    const set = JSON.parse(
      await readFile(join(root, 'eval', 'questions.json'), 'utf8'),
    ) as EvalSet;
    const report = await runEval(
      {
        siteName: 'Example Docs',
        index,
        keyword: new KeywordSearch(index),
        llm: resolved.llm,
        limits: {
          maxQuestionLength: 500,
          maxOutputTokens: 800,
          maxHistoryTurns: 6,
          contextTokens: 3000,
        },
      },
      set,
    );
    const metrics = evalMetrics(report);
    console.info(
      `[eval-live] ${provider}/${model} ${Object.entries(metrics)
        .map(([k, v]) => `${k}=${v.toFixed(3)}`)
        .join(' ')}`,
    );
    if (report.firstToken)
      console.info(
        `[eval-live] first token: p50=${report.firstToken.p50.toFixed(0)}ms p95=${report.firstToken.p95.toFixed(0)}ms (target: under 2000ms)`,
      );
    await mkdir(join(root, 'eval', 'results'), { recursive: true });
    await writeFile(
      join(root, 'eval', 'results', 'live.json'),
      JSON.stringify(
        { provider, model, metrics, firstToken: report.firstToken, report },
        null,
        2,
      ),
    );
    expect(report.citations.validity).toBe(1);
  }, 600_000);
});
