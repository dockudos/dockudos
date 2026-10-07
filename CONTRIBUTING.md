# Contributing

Thanks for helping. dockudos is early; the plan in [`notes/plan/`](./notes/plan) shows what is being built and in what order.

## Before you start

- Open an issue before large changes.
- Keep pull requests small and focused on one task (plan tasks have IDs like `P1.12`).
- Read the relevant [ADRs](./notes/adr) so you do not re-litigate decided questions.

## Workflow

1. `pnpm install`
2. Make the change with tests. New logic gets a unit test; user-facing behavior gets an e2e test on `apps/example` where practical.
3. Run what CI runs: `pnpm nx affected -t lint typecheck test build e2e`, then `pnpm format:check` and `pnpm check:boundaries`.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org), for example `feat(core): validate docs.json [P1.1]`. CI checks every commit in a pull request.

Scopes: `core`, `next`, `ui`, `cli`, `example`, `web`, `repo`, `release`.

## Conventions

- TypeScript everywhere, strict. Run tasks through Nx, never the underlying tools directly.
- Relative imports inside packages use `.ts`/`.tsx` extensions; `rewriteRelativeImportExtensions` emits `.js`.
- `core` must stay headless: no React, no Next, and no Node APIs outside `src/node.ts`.
- Respect the dependency direction in [ADR 0005](./notes/adr/0005-package-layout.md); lint enforces it.
- Secrets never go in `docs.json` or client code.
- Do not weaken checks to get to green (no skipped tests, no blanket lint suppressions).

## License and contributions

dockudos is licensed under [Apache 2.0](./LICENSE). By contributing you agree your contribution is licensed under the same terms (Apache 2.0, section 5).

Open item: decide between a CLA and a DCO sign-off before accepting outside contributions at scale (see [ADR 0001](./notes/adr/0001-license-apache-2.md)). A code of conduct is added with the first public release (Phase 1, P1.31).
