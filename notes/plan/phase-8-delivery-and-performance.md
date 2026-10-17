# Phase 8: Delivery and performance

**Goal:** a docs author gets CI/CD for their site out of the box, and the performance of a dockudos site is measured, budgeted and published rather than assumed.

**Depends on:** Phase 1 (`dockudos init`, templates), Phase 4 (static export), Phase 5 (Docker, Compose, Helm). **Done when:** a new site from `dockudos init` has a working pipeline that checks and deploys it, and CI fails when a page regresses past its budget.

Today: the repository has its own CI (`.github/workflows/ci.yml`, `platform.yml`, `release.yml`, `eval-live.yml`), the CLI has `build`, `broken-links`, `index` and `build --static`, and the init template (`packages/cli/templates/default`) has a `Dockerfile` but **no workflow files**. Bundle and search budgets exist for the library (`bundle.spec.ts`, `search-benchmark.spec.ts`) but nothing measures a built site's pages.

## Tasks

### 8A. CI/CD for authors
- [ ] P8.1 `dockudos init --ci <github|gitlab|none>` (asked interactively, default `github`) writes a pipeline: install, `dockudos build` (which already validates `docs.json` and checks links), upload the output.
- [ ] P8.2 Pull-request checks: broken links, `docs.json` schema, build, and the performance budget (8B). Comment on the PR with a short summary.
- [ ] P8.3 Preview deployments: static export uploaded as an artifact for every PR; ready-made recipes for GitHub Pages, Cloudflare Pages, Netlify, Vercel and S3 plus CloudFront. Each recipe is tested by dry run where a real deploy is impossible, and says so.
- [ ] P8.4 Production deploy on merge to the default branch, with `base-path` handling for project pages.
- [ ] P8.5 A reusable GitHub Action (`dockudos/action`) wrapping check, build and deploy, versioned with the CLI; same logic available as a GitLab include. Tokens only from secrets; the workflow requests the least permissions.
- [ ] P8.6 `dockudos check` command: one command that CI and people run locally (config, links, build, budgets) with a stable exit code and machine-readable output (`--json`, SARIF for link errors).
- [ ] P8.7 Scheduled job: external link check weekly with an issue opened on failure.
- [ ] P8.8 Docs in `apps/docs`: guide "Deploy and CI", reference for `check` and `init --ci`.

### 8B. Performance
- [ ] P8.9 Define budgets in one place (`architecture.md` section 10 plus new ones): LCP, CLS, INP, total JS per page, HTML size, search index size, time to first byte for the static export. Store them in `docs.json` (`performance.budgets`) with defaults.
- [ ] P8.10 Measure a built site: Lighthouse CI (or `playwright` + web-vitals) against a set of representative pages (home, long article, API endpoint, search open, assistant open), desktop and mobile profiles, on `apps/example` and `apps/docs`.
- [ ] P8.11 Fail CI when a budget is exceeded; publish the numbers per commit as a build artifact and keep a trend file so a regression names the commit.
- [ ] P8.12 Large-site build time: `next build` of 2,000 and 4,000 pages (the two numbers Phases 3 and 4 listed as not run), recorded with the machine used.
- [ ] P8.13 Fix what the measurements find. Known suspects to check first: the first-load script size of pages with the assistant, the playground and CodeMirror chunks, font loading, image sizing, the Mermaid and math chunks.
- [ ] P8.14 Publish a performance page in `apps/docs` with the measured numbers, the method, and how to run it on your own site. No figure is published without a run behind it.
- [ ] P8.15 The same checks as a command: `dockudos check --performance` for a built site, so authors can verify their own.

### 8C. Branding hooks (confirm first)
- [ ] P8.16 Audit what branding allows today (theme tokens, custom CSS, layouts, logo, fonts, components override via `mdx-components.tsx`) against what other platforms offer; write the result as a table in `apps/docs`.
- [ ] P8.17 Close any real gap the audit finds: for example a documented, sandbox-aware `scripts` entry for custom JavaScript, head tags, and a component slot API for header and footer. Only gaps with a user need; each gets a test and a docs section.

## Acceptance criteria

- [ ] `dockudos init --ci github` in a fresh folder produces a workflow that passes on a clean push (verified on a real GitHub repository once the remote exists, and with `act` or a YAML and schema check before that).
- [ ] A pull request that breaks a link, breaks `docs.json`, or exceeds a budget fails its check with a message naming the cause.
- [ ] Budgets and the last measured numbers for `apps/docs` are in the repository and on the performance page.
- [ ] `next build` timings at 2,000 and 4,000 pages are recorded in Phases 3 and 4's "not run" notes and removed from them.

## Tests

- [ ] Unit: generated workflow files (snapshot, YAML parses, permissions are minimal, no secret printed), `check` exit codes and JSON output, budget parsing and defaults.
- [ ] Integration: `init --ci` then `check` in a temp project; a deliberately broken link and an oversized page fail.
- [ ] Performance: Lighthouse or web-vitals run on `apps/example` in CI with budgets enforced; flake handling (median of N runs).
- [ ] Workflow lint: `actionlint` on every generated and repository workflow.

## Risks

- **Flaky performance numbers.** Use medians of several runs, fixed throttling and a pinned browser; alert on trends, fail only on clear breaches.
- **Deploy recipes drift.** Pin versions, date each recipe, and test the parts that can run without credentials.
- **No GitHub remote yet.** P0.2b and P0.11 (create the remote, first CI run) come first; this phase's real-repo checks wait on them.
