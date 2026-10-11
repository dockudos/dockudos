#!/usr/bin/env node
// Runs the docs agent's evaluation set against a real model and prints the numbers. Costs a little money and needs a key:
//   DOCKUDOS_LLM_API_KEY=... EVAL_PROVIDER=anthropic EVAL_MODEL=<model> node tools/eval-agent-live.mjs
// The same set runs on every change with a stand-in model (packages/platform/src/lib/agent-eval.spec.ts); this one measures
// whether a real model's edits are acceptable. Exits non-zero below the thresholds (EVAL_MIN_EDITS, default 0.8).
import { anthropicProvider, openaiProvider } from '@dockudos/core';
import { AGENT_EVAL_SET, runAgentEval } from '@dockudos/platform';

const key = process.env.DOCKUDOS_LLM_API_KEY;
const model = process.env.EVAL_MODEL;
if (!key || !model) {
  console.error(
    'Set DOCKUDOS_LLM_API_KEY and EVAL_MODEL (and EVAL_PROVIDER=anthropic|openai).',
  );
  process.exit(2);
}
const llm = (
  process.env.EVAL_PROVIDER === 'openai' ? openaiProvider : anthropicProvider
)({ apiKey: key, model });
const report = await runAgentEval(AGENT_EVAL_SET, { llm });
console.log(JSON.stringify(report, null, 2));
const edits = report.edits.attempted
  ? report.edits.acceptable / report.edits.attempted
  : 1;
const min = Number(process.env.EVAL_MIN_EDITS ?? 0.8);
const ok = report.recall >= 0.9 && report.directPublishes === 0 && edits >= min;
console.log(
  ok
    ? '\nok'
    : `\nbelow the bar (recall >= 0.9, edits >= ${min}, no direct publishes)`,
);
process.exit(ok ? 0 : 1);
