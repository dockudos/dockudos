# Phase 0: Foundation

**Goal:** a healthy workspace where every later task lands with build, lint, test and CI already working, and one MDX page renders end to end.

**Depends on:** nothing. **Blocks:** everything.

## Tasks

### Decisions (development.md section 10)
- [x] P0.1 Pick the license (leaning Apache 2.0); add `LICENSE` and set `license` in every `package.json` (root currently says MIT).
- [x] P0.2 Confirm `dockudos` is free on npm, GitHub and as a domain, and that the `@dockudos` npm scope is available. Checked 2026-10-07: `dockudos` and `@dockudos/{core,cli,next,ui}` return 404 on npm, GitHub user/org `dockudos` returns 404, no DNS for `dockudos.com/.dev/.io`. This is not a registration check; the npm scope itself and WHOIS are unverified.
- [ ] P0.2b **Owner action:** reserve the `@dockudos` npm org, the `dockudos` GitHub org and a domain (outward-facing, so not done by the agent).
- [x] P0.3 Decide the role of `apps/web` (marketing site vs. future `apps/docs`) and rename/move it accordingly.
- [x] P0.4 Decide the first LLM and embedding adapters to ship in Phase 2 (record in an ADR).
- [x] P0.5 Write ADRs in `notes/adr/` for: Nx over Turborepo, App Router only, keyword-first retrieval, package merge strategy.

### Workspace audit
- [x] P0.6 Audit `packages/{core,next,cli,ui}` and `apps/{example,web}`: each has `build`, `lint`, `test` targets that pass on an empty/trivial implementation.
- [x] P0.7 Make packages publishable: `@dockudos/core|next|cli|ui` have correct `exports`, `types`, `files`, `publishConfig`, build output (tsc or tsup). `ui` is currently `private` and points `main` at `src`; define the published shape.
- [x] P0.8 Enforce module boundaries with `@nx/enforce-module-boundaries` tags: `core` depends on nothing; `ui` on `core`; `next` on `core`+`ui`; `cli` on `core`+`next`.
- [x] P0.9 Add a shared `tsconfig.base.json` path/`workspace:*` linking so apps import packages without relative paths.
- [x] P0.10 Add Playwright to `apps/example` (e2e project) with one smoke test.

### CI and release
- [ ] P0.11 GitHub Actions: `nx affected -t lint,test,build,e2e` on pull requests; cache Nx; Node 20 and 22 matrix. *Written in `.github/workflows/ci.yml` (also runs format, boundary and commit checks); not yet run on GitHub because the repo has no remote. Verified locally only on Node 24.*
- [x] P0.12 Conventional-commit check (commitlint or PR title check).
- [x] P0.13 Configure `nx release` (versioning, changelog, npm provenance); run `nx release --dry-run` successfully.
- [x] P0.14 Local registry (Verdaccio target already present): publish and install the packages in a scratch project to prove they are consumable.

### First vertical slice (development.md section 4, steps 2-4)
- [x] P0.15 `core`: minimal `docs.json` schema (zod or similar) with `name` and `navigation`, plus validation errors that name the key.
- [x] P0.16 `core`: minimal page tree built from a `docs/` folder.
- [x] P0.17 `next`: `withDocs()` that compiles one MDX file into a route.
- [x] P0.18 `apps/example`: `docs/index.mdx` renders at `/` end to end.

### Repo hygiene
- [x] P0.19 Root `README.md` describing the project and how to run it; `CONTRIBUTING.md`; `.editorconfig`; Prettier config.
- [x] P0.20a `.gitignore` covers `dist`, `out-tsc`, `.next`, `tmp`, `.serena`, Playwright output.
- [ ] P0.20b Commit the pending workspace changes in logical commits (left uncommitted for the owner to review; includes earlier uncommitted `apps/web` and `packages/ui` work).

## Acceptance criteria

- [x] `pnpm install && pnpm nx run-many -t lint,test,build` passes from a clean clone. *Verified on a copy of the working tree with no `node_modules`, using `pnpm install --frozen-lockfile` then `lint typecheck test build e2e` and `format:check`. Not yet verified on an actual git clone of a commit.*
- [x] `pnpm nx dev example` serves a page compiled from `docs/index.mdx`. *Verified: `pnpm nx dev @dockudos/example` serves `/` and `/guides/hello` on :3000, unknown path returns 404.*
- [ ] A pull request triggers CI and CI is green; a deliberately broken boundary import fails lint. *Boundary half verified by `pnpm check:boundaries`. CI half is pending a GitHub remote.*
- [x] `pnpm nx release --dry-run` completes and shows the expected version bumps and changelog. *Verified with `--first-release --specifier 0.1.0`; changelog is empty until conventional commits exist.*
- [x] Packages installed from Verdaccio into a scratch project import and typecheck. *Verified by `pnpm verify:packages` (installs all four packages, runs `tsc`, imports under Node ESM).*
- [x] License and name decisions are recorded and visible in the repo. *LICENSE, ADR 0001, and name check results in this file.*

## Tests

- [x] Unit (core): valid config passes; missing `name` fails with a message containing the key path; unknown key handling is defined and tested.
- [x] Unit (core): page tree from a fixture folder gives expected paths and order.
- [x] Unit (next): `withDocs()` returns a config that preserves the user's existing Next config fields.
- [x] E2E (example): `/` returns 200 and shows the MDX heading.
- [x] Lint: module-boundary rule has a failing fixture proving it works.
- [ ] CI: a workflow run on a throwaway PR is green.
