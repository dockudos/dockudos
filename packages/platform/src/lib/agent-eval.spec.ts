import { mockLLM } from '@dockudos/core';
import { describe, expect, it } from 'vitest';
import { runAgentEval } from './agent-eval.ts';
import { AGENT_EVAL_SET } from './agent-eval-set.ts';

/** A model that does exactly what a careful editor would: replace the old word with the new one, using the evidence. */
const oracle = mockLLM((input) => {
  const text = input.messages[0]!.content;
  const page = /<(\w+)-page>\n([\s\S]*?)\n<\/\1-page>/.exec(text)![2]!;
  const evidence = /<(\w+)-evidence>\n([\s\S]*?)\n<\/\1-evidence>/.exec(text)![2]!;
  let out = page;
  for (const m of evidence.matchAll(/^-.*?\b(WEBHOOK_SECRET|verifySignature|primaryColor|AUTH_ISSUER)\b/gm)) {
    const next = { WEBHOOK_SECRET: 'HOOKS_SIGNING_KEY', verifySignature: 'verifyDelivery', primaryColor: 'brandColor', AUTH_ISSUER: 'OIDC_ISSUER_URL' }[m[1] as string]!;
    out = out.split(m[1]!).join(next);
  }
  for (const m of evidence.matchAll(/^-.*(--base-path)/gm)) out = out.split('\n').filter((l) => !l.includes(m[1]!)).join('\n');
  for (const m of evidence.matchAll(/^\+.*?(--out-dir)/gm)) if (!out.includes(m[1]!)) out += `\nSee also \`${m[1]}\`.\n`;
  for (const m of evidence.matchAll(/^\+.*router\.(get|post|put|delete)\('([^']+)'/gm)) {
    const route = `${m[1]!.toUpperCase()} ${m[2]}`;
    if (!out.includes(route)) out += `\n\`${route}\` is also available.\n`;
  }
  return out === page ? 'DECISION: NO_CHANGE\nRATIONALE: nothing to do' : `DECISION: UPDATE\nRATIONALE: Matches the code change.\nCONTENT:\n${out}`;
});

describe('agent evaluation set (P5.18)', () => {
  it('flags the expected pages, stays quiet when it should, and publishes nothing directly', async () => {
    const report = await runAgentEval(AGENT_EVAL_SET);
    expect(report.failures).toEqual([]);
    expect(report.recall).toBeGreaterThanOrEqual(0.9);
    expect(report.precision).toBeGreaterThanOrEqual(0.9);
    expect(report.quietCases).toEqual({ passed: 3, total: 3 });
    expect(report.directPublishes).toBe(0);
  });

  it('produces acceptable edits end to end with a model, and still publishes nothing directly', async () => {
    const report = await runAgentEval(AGENT_EVAL_SET, { llm: oracle });
    expect(report.edits).toBeDefined();
    expect(report.failures).toEqual([]);
    expect(report.edits!.acceptable / report.edits!.attempted).toBeGreaterThanOrEqual(0.85);
    expect(report.directPublishes).toBe(0);
  });

  it('reports misses and unacceptable edits instead of hiding them', async () => {
    const bad = mockLLM(() => 'DECISION: UPDATE\nRATIONALE: x\nCONTENT:\n---\ntitle: "x"\n---\n\nunrelated\n');
    const report = await runAgentEval([AGENT_EVAL_SET[0]!, { ...AGENT_EVAL_SET[7]!, expectedPages: ['/guides/install'] }], { llm: bad });
    expect(report.failures.join('\n')).toMatch(/missed \/guides\/install/);
    expect(report.failures.join('\n')).toMatch(/not acceptable|rewrites most/);
    expect(report.edits!.acceptable).toBe(0);
    expect(report.recall).toBeLessThan(1);
  });
});
