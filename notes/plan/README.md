# dockudos build plan

Phase-by-phase plan derived from [development.md](../development.md), [features.md](../features.md), [architecture.md](../architecture.md), [ai.md](../ai.md) and [self-hosting.md](../self-hosting.md). The paid side has its own notes in [../enterprise/](../enterprise/README.md).

## Phases

| # | File | Goal | Status |
| --- | --- | --- | --- |
| 0 | [phase-0-foundation.md](./phase-0-foundation.md) | Workspace, tooling, CI, one MDX page rendering end to end | [ ] 3 items left: P0.2b, P0.11 first CI run, P0.20b commit |
| 1 | [phase-1-core-library.md](./phase-1-core-library.md) | `npx dockudos init` gives a polished docs site in minutes (MVP) | [ ] 2 items left, both waiting on the owner: P1.30b publish to npm, and the "install from real npm" acceptance check |
| 2 | [phase-2-search-and-ai.md](./phase-2-search-and-ai.md) | Visitors can find or ask for anything; AI tools can read the docs | [ ] 2 items left: P2.10b hosted search adapters (deferred by design, on demand) and the "first AI token under 2 s" check, which needs a live key (the `eval-live` workflow measures it) |
| 3 | [phase-3-api-docs.md](./phase-3-api-docs.md) | A spec becomes an interactive API reference | [x] done. Not run: the playground proxy in a browser (unit-tested only), a `next build` of 2,000 pages (generation of 2,000 operations is benchmarked) |
| 4 | [phase-4-content-at-scale.md](./phase-4-content-at-scale.md) | Versions, languages, private docs, export | [x] done. Not run: a hosted identity provider, the W3C feed validator and `epubcheck` (offline), `next build` timing at 4,000 pages |
| 5 | [phase-5-platform-and-cloud.md](./phase-5-platform-and-cloud.md) | Self-hostable platform | [ ] built and tested; 8 items left that need things this environment did not have: P5.19 and P5.20 (no Docker daemon, so no image was built and Compose was never started), the Compose and kind runs of the acceptance and test lists, "editor preview matches the built page" (the preview skips build-time plugins), and the independent `security-auditor` review. Not run: GitHub/GitLab live APIs, a hosted identity provider, a real worker build, `pnpm eval:agent` with a real model |
| E | [../enterprise/plan.md](../enterprise/plan.md) | Paid managed cloud and enterprise tier, in a separate private repo | [ ] |

Sequencing (from development.md): ship Phase 1 and publish to npm, then Phase 2 (the differentiator), then Phase 3 and 4 driven by user demand, then Phase 5 once there is real self-hosted usage.

## Conventions

- **Checkboxes:** `[ ]` not started, `[x]` done. Tick a box only when its evidence exists (merged code, passing test, shipped output). A phase is done when every box in **Tasks**, **Acceptance criteria** and **Tests** is ticked.
- **Task IDs** are `P<phase>.<n>` so commits and PRs can reference them (`feat(core): config schema [P1.2]`).
- **Each task ends in a passing build and a test** (development.md section 4). No task is "done" with a red `pnpm nx affected -t lint,test,build`.
- **Run everything through Nx**, prefixed with pnpm: `pnpm nx run-many -t build`, `pnpm nx affected -t lint,test,build,e2e`. Check `--help` before using a flag you are not sure of.
- **Scaffolding uses Nx generators** (`nx-generate` skill) rather than hand-made project files.
- **Fewer packages first:** `search`, `mcp` and `openapi` start inside `core`/`ai` and are split out only when they need to stand alone.
- **Definition of done for every task:** code, tests, docs page in `apps/docs` for any user-facing change, conventional commit.

## Cross-cutting tracks

These apply to every phase; each phase file lists the concrete items.

- [x] **Accessibility:** keyboard navigation, focus states, axe checks on `apps/example` in light and dark mode. *Phase 1: 22 axe runs, keyboard e2e for tabs, accordion, tooltip, drawer, sidebar and skip link. Keep adding as components arrive.*
- [x] **Security:** secrets only from env vars, rate limits on AI endpoints, retrieved text treated as untrusted data. *Phase 2: keys read from the environment only and scanned for in bundles and responses (e2e), per-visitor and site-wide limits, excerpts quoted between random markers, no tools for the model.*
- [x] **Performance:** budgets from architecture.md section 10 tracked in CI once measurable. *Phase 2: palette search under 100 ms on 1,000 pages (`search-benchmark.spec.ts`), palette chunk and first-load script budgets (`bundle.spec.ts`). First AI token: live job.*
- [ ] **Docs:** `apps/docs` (built with dockudos) is updated alongside every feature.
- [ ] **Open decisions resolved** (see Phase 0): license, name availability, first LLM/embedding adapters.
