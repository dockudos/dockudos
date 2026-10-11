import { buildContentIndex, type LLMProvider } from '@dockudos/core';
import { checkDraft, draftEdit } from './agent-draft.ts';
import { createAgentGit } from './agent.ts';
import { mapChangesToPages } from './agent-map.ts';
import { createMemoryGit } from './git/memory.ts';
import type { ChangedFile } from './git/types.ts';

export interface AgentEvalCase {
  id: string;
  /** The docs, as they stand. */
  pages: { path: string; title: string; body: string }[];
  /** The code change, as a host would report it. */
  change: ChangedFile[];
  /** Pages that should be flagged. Empty means "this change needs no doc edit". */
  expectedPages: string[];
  /** What an acceptable edit to each expected page looks like. */
  edit?: { mustContain: string[]; mustNotContain?: string[] };
}

export interface AgentEvalReport {
  cases: number;
  /** Share of expected pages that were flagged. */
  recall: number;
  /** Share of flagged pages that were expected. */
  precision: number;
  /** Cases that expect nothing and got nothing. */
  quietCases: { passed: number; total: number };
  /** With a model: edits that passed the checks and contain what they should, out of edits attempted. */
  edits?: { acceptable: number; attempted: number };
  /** Pushes to the default branch made while running the cases. Must be 0. */
  directPublishes: number;
  failures: string[];
}

const frontMatter = (title: string, body: string) =>
  `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`;

/**
 * Run the agent's judgment over a set of cases. Mapping (which pages does this change touch?) is deterministic and
 * always measured. Editing is measured when a model is given: the draft must pass the same checks the agent applies
 * and contain the expected text. Every case also opens its pull request through the real `createAgentGit` on an
 * in-memory Git host, to prove nothing ever lands on the default branch.
 */
export async function runAgentEval(
  cases: readonly AgentEvalCase[],
  { llm }: { llm?: LLMProvider } = {},
): Promise<AgentEvalReport> {
  let expected = 0,
    found = 0,
    flaggedTotal = 0;
  let quiet = 0,
    quietTotal = 0,
    attempted = 0,
    acceptable = 0,
    direct = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const index = buildContentIndex(
      c.pages.map((p) => ({ path: p.path, title: p.title, body: p.body })),
    ).index;
    const flagged = mapChangesToPages(index, c.change).map((a) => a.path);
    expected += c.expectedPages.length;
    found += c.expectedPages.filter((p) => flagged.includes(p)).length;
    flaggedTotal += flagged.length;
    const missed = c.expectedPages.filter((p) => !flagged.includes(p));
    const extra = flagged.filter((p) => !c.expectedPages.includes(p));
    if (missed.length) failures.push(`${c.id}: missed ${missed.join(', ')}`);
    if (extra.length)
      failures.push(`${c.id}: flagged unexpected ${extra.join(', ')}`);
    if (!c.expectedPages.length) {
      quietTotal++;
      if (!flagged.length) quiet++;
    }

    const git = createMemoryGit();
    const files = Object.fromEntries(
      c.pages.map((p) => [`docs${p.path}.mdx`, frontMatter(p.title, p.body)]),
    );
    const base = git.seed('eval/docs', files);
    const edits: { path: string; content: string }[] = [];
    if (llm) {
      for (const path of c.expectedPages.filter((p) => flagged.includes(p))) {
        const page = c.pages.find((p) => p.path === path)!;
        const source = frontMatter(page.title, page.body);
        attempted++;
        const draft = await draftEdit({
          llm,
          page: { path, title: page.title, source },
          changes: c.change,
        }).catch(() => undefined);
        if (draft?.decision !== 'update') {
          failures.push(`${c.id}: no edit for ${path}`);
          continue;
        }
        const ok = checkDraft(source, draft.content, `docs${path}.mdx`);
        const hasAll = (c.edit?.mustContain ?? []).every((t) =>
          draft.content.includes(t),
        );
        const hasNone = (c.edit?.mustNotContain ?? []).every(
          (t) => !draft.content.includes(t),
        );
        if (ok.ok && hasAll && hasNone) {
          acceptable++;
          edits.push({ path: `docs${path}.mdx`, content: draft.content });
        } else
          failures.push(
            `${c.id}: edit to ${path} not acceptable (${ok.ok ? (hasAll ? 'contains forbidden text' : 'missing expected text') : ok.reason})`,
          );
      }
    }
    if (edits.length)
      await createAgentGit(git, 'eval/docs', 'main').openPullRequest({
        baseSha: base,
        hint: c.id,
        message: 'eval',
        title: 'eval',
        body: 'eval',
        changes: edits,
      });
    direct += git.pushes.filter((p) => p.branch === 'main').length;
  }
  return {
    cases: cases.length,
    recall: expected ? found / expected : 1,
    precision: flaggedTotal
      ? (flaggedTotal -
          failures
            .filter((f) => f.includes('flagged unexpected'))
            .reduce((n, f) => n + f.split(',').length, 0)) /
        flaggedTotal
      : 1,
    quietCases: { passed: quiet, total: quietTotal },
    ...(llm && { edits: { acceptable, attempted } }),
    directPublishes: direct,
    failures,
  };
}
