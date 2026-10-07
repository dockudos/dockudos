# dockudos build plan

Phase-by-phase plan derived from [development.md](../development.md), [features.md](../features.md), [architecture.md](../architecture.md), [ai.md](../ai.md) and [self-hosting-and-cloud.md](../self-hosting-and-cloud.md).

## Phases

| # | File | Goal | Status |
| --- | --- | --- | --- |
| 0 | [phase-0-foundation.md](./phase-0-foundation.md) | Workspace, tooling, CI, one MDX page rendering end to end | [ ] 3 items left: P0.2b, P0.11 first CI run, P0.20b commit |
| 1 | [phase-1-core-library.md](./phase-1-core-library.md) | `npx dockudos init` gives a polished docs site in minutes (MVP) | [ ] |
| 2 | [phase-2-search-and-ai.md](./phase-2-search-and-ai.md) | Visitors can find or ask for anything; AI tools can read the docs | [ ] |
| 3 | [phase-3-api-docs.md](./phase-3-api-docs.md) | A spec becomes an interactive API reference | [ ] |
| 4 | [phase-4-content-at-scale.md](./phase-4-content-at-scale.md) | Versions, languages, private docs, export | [ ] |
| 5 | [phase-5-platform-and-cloud.md](./phase-5-platform-and-cloud.md) | Self-hostable platform, then the paid managed cloud | [ ] |

Sequencing (from development.md): ship Phase 1 and publish to npm, then Phase 2 (the differentiator), then Phase 3 and 4 driven by user demand, then Phase 5 once there is real self-hosted usage.

## Conventions

- **Checkboxes:** `[ ]` not started, `[x]` done. Tick a box only when its evidence exists (merged code, passing test, shipped output). A phase is done when every box in **Tasks**, **Acceptance criteria** and **Tests** is ticked.
- **Task IDs** are `P<phase>.<n>` so commits and PRs can reference them (`feat(core): config schema [P1.2]`).
- **Each task ends in a passing build and a test** (development.md section 4). No task is "done" with a red `pnpm nx affected -t lint,test,build`.
- **Run everything through Nx**, prefixed with pnpm: `pnpm nx run-many -t build`, `pnpm nx affected -t lint,test,build,e2e`. Check `--help` before using a flag you are not sure of.
- **Scaffolding uses Nx generators** (`nx-generate` skill) rather than hand-made project files.
- **Fewer packages first:** `search`, `mcp` and `openapi` start inside `core`/`ai` and are split out only when they need to stand alone.
- **Definition of done for every task:** code, tests, docs page in `apps/docs` for any user-facing change, conventional commit.

## Current repo state (at plan time)

- Nx workspace exists, pnpm, TypeScript 6, Vitest, Next 16, React 19, Tailwind 4.
- Projects scaffolded: `packages/core`, `packages/next`, `packages/cli`, `packages/ui` (shadcn-style, Tailwind 4), `apps/example`, `apps/web`.
- Nothing from the product itself is implemented yet. Phase 0 audits what is there and closes the gaps.

## Cross-cutting tracks

These apply to every phase; each phase file lists the concrete items.

- [ ] **Accessibility:** keyboard navigation, focus states, axe checks on `apps/example` in light and dark mode.
- [ ] **Security:** secrets only from env vars, rate limits on AI endpoints, retrieved text treated as untrusted data.
- [ ] **Performance:** budgets from architecture.md section 10 tracked in CI once measurable.
- [ ] **Docs:** `apps/docs` (built with dockudos) is updated alongside every feature.
- [ ] **Open decisions resolved** (see Phase 0): license, name availability, first LLM/embedding adapters.
