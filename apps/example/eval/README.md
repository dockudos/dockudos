# Evaluation of the assistant

`questions.json` is a fixed set of cases for the example site:

- **questions** the docs answer, with the section that answers each;
- **unanswerable** questions: off topic, or about something the product does not do;
- **navigation** requests ("change my billing email"), with the section they mean (a list means any of them is right).

`specs/eval.spec.ts` runs the set through the real pipeline (retrieval, prompts, citation checks, refusals, navigation) with
a stand-in model that needs no key (`extractiveLLM` from `@dockudos/core`), in two setups: keywords only, and keywords plus
vectors. It measures:

| Metric                | Means                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `retrievalHitRate`    | The right page is among the top 5 chunks.                                                       |
| `citationValidity`    | Every citation names a source the model was given, at a page and heading that exist. Must be 1. |
| `refusalAccuracy`     | Answerable questions are answered, unanswerable ones are declined.                              |
| `navigationAccuracy*` | The request lands on the right section, chosen by search alone and by the model.                |

The numbers are compared with `baseline.json`; a worse number fails the build. When they improve, record them:

```bash
UPDATE_EVAL_BASELINE=1 pnpm nx test @dockudos/example --skip-nx-cache
```

The baseline only ever goes up. Each run writes `results/latest.json` (not committed), which CI uploads, so runs can be compared.

The stand-in model is deliberately plain: it quotes the sentence that shares most words with the question. The set therefore tells you
that the machinery around a model works, not how good a particular model is. For that, run the live job (`.github/workflows/eval-live.yml`)
with your own key.

Known misses are left in on purpose: `sla` is a question the docs do not answer, but the stand-in model finds a sentence about the Enterprise plan and
answers it. A real model should decline.
