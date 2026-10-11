# Phase 5: Platform

**Goal:** the full platform is self-hostable. The paid managed cloud and enterprise tier are planned separately in [../enterprise/plan.md](../enterprise/plan.md) and built in a separate private repository.

**Depends on:** Phases 1-4. Per development.md, the enterprise work starts only once there is real self-hosted usage to convert.

**Done when:** a team can self-host the whole platform with `docker compose up`. (The "live site on their own domain, and pay without talking to us" check moved to the [enterprise plan](../enterprise/plan.md).)

## Open-source platform (`apps/platform`, self-hostable)

### Tasks

#### Shared infrastructure
- [x] P5.1 `apps/platform` scaffold (Nx), shared libs for DB access, config, logging; Postgres schema + migrations. *`packages/platform` (config, redacting JSON logger, DB access, 14-table schema with advisory-locked migrations) and `apps/platform` (the dashboard). `DOCKUDOS_*` variables validated at start, every problem reported at once. The `pg` adapter is tested against a Postgres wire-protocol server.*
- [x] P5.2 Job queue for builds and agent runs; S3-compatible object storage client for uploads and build artifacts. *Postgres job queue (`SKIP LOCKED`, lease expiry, backoff 5 s to 10 min, idempotency keys, enqueue inside the caller's transaction, dead letters), S3 client with hand-written SigV4 (checked against AWS's published vector), file and memory storage.*
- [x] P5.3 Git provider abstraction (GitHub first, GitLab second): clone, commit, branch, open PR, webhooks. *GitHub and GitLab over REST: read files and trees, branches, one-commit multi-file writes with conflict detection, pull/merge requests, compare, commit status, `git fetch --depth 1` for builds. Tested with mocked HTTP and an in-memory host with real commit semantics; never run against the live APIs.*
- [x] P5.4 Observability baseline: structured logs, health endpoints, basic metrics. *JSON logs with secret scrubbing, Prometheus `/metrics`, `/healthz` and `/readyz` (database and storage), request/job/build/webhook/agent counters.*

#### Auth and teams
- [x] P5.5 Auth: OAuth/OIDC; teams and roles; API keys. (SAML and audit logs are enterprise, task E.12.) *OIDC sign-in (tested with an in-process provider), teams with viewer/editor/admin/owner, no escalation, last-owner protection, hashed API keys with expiry and revoke.*
- [x] P5.6 Plug platform auth into Phase 4 private docs and the assistant/MCP token flow. *Team membership becomes `team:<slug>` groups and `team:<slug>:<role>` roles; platform sign-in also sets the private-docs cookie; `createPlatformVerify` in `@dockudos/next/access` for bearer keys, assistant and MCP. Integration-tested through `createAccessProxy` (`private-docs.spec.ts`).*

#### Hooks
- [x] P5.7 GitHub and GitLab webhook receiver with signature verification; triggers rebuild on push; idempotent and retry-safe. *Signature check before parsing (HMAC or token, constant time), identical 401s, delivery id and build queued in one transaction, retries and redeliveries are no-ops, other branches, repositories and docs-folder-free pushes ignored.*
- [x] P5.8 Build runner producing the site and index, storing artifacts, reporting status. *Fetch the pushed commit, install with scripts off, `dockudos build --static` and `dockudos index`, upload files and index, switch the live pointer only if no newer build is live, report status on the commit, keep the last 10. The build commands themselves are faked in tests; `dockudos build --static` is covered by Phase 4's own tests, and a real build in a worker has not been run.*

#### Editor
- [x] P5.9 Visual Markdown/MDX editor with live preview using the real components. *Source editor with a formatting toolbar and a live preview of the real components, compiled with MDX in a sandboxed frame (opaque origin, no network). Not a WYSIWYG editor, and the preview skips build-time plugins (code highlighting, math, diagrams).*
- [x] P5.10 Git-backed saves: edits become commits/PRs; files stay the source of truth; conflict handling. *Every save is a branch and a pull request (admins may commit directly); the editor remembers its base commit and returns the upstream text when a file you edited changed, so the person decides; files stay the source of truth.*
- [x] P5.11 Media upload, page/navigation management, `docs.json` form editing with schema validation. *Image/PDF upload sniffed by bytes with SVG sanitising, create/rename/delete page with sidebar and redirect updates, `docs.json` form plus raw JSON validated against the real schema as you type, editable paths limited to `docs.json`, `docs/**` and `public/media/*`.*

#### Analytics
- [x] P5.12 Event ingestion (page views, searches including zero-result, feedback, assistant conversations, human vs. AI-tool traffic). *`/api/v1/ingest/:site` (CORS, rate-limited) and `/analytics.js` (page views, SPA navigation, Do Not Track); the UI announces searches, feedback and assistant answers as `dockudos:track`. Human, AI-tool and other-bot traffic told apart.*
- [x] P5.13 Privacy defaults: no personal data, IP truncation, cookie-free counting; conversation logging opt-in with retention setting. *No IP, user agent, cookie, query string or referrer path stored; keyed one-day visitor hash; search text scrubbed; conversations opt-in with retention and deleted when switched off; event retention purge.*
- [x] P5.14 Dashboards: top pages, failed searches, feedback, assistant questions and unanswered topics. *Top pages, views per day, failed searches, feedback per page, assistant answered/unanswered with topics, AI agents, referrers; browser test renders seeded data.*

#### AI agent
- [x] P5.15 Change watcher on code and docs repos; map code changes to affected pages via the index. *Poll code repositories, diff against the last head, map changed env vars, flags, exports, routes and options to pages through the content index (no model needed, deterministic).*
- [x] P5.16 Draft edits and open PRs (never publish directly); PR description explains why. *Model drafts one page at a time from fenced untrusted input in a fixed format; edits are validated (front matter, not a rewrite, no new imports or scripts); one pull request with the reasons. The only write interface creates a new `dockudos/agent-…` branch and a pull request.*
- [x] P5.17 Scheduled automations (outdated pages, broken links); BYO LLM key for self-hosters. *Weekly or on-demand broken-link fixes (relinks only when exactly one page is clearly meant) and outdated-page checks (identifiers the code no longer contains); the model key is the owner's own.*
- [x] P5.18 Agent evaluation set: given a code diff, expected pages flagged and acceptable edits. *10 cases: expected pages, quiet cases (tests, lockfiles, internal refactors), acceptable edits, and the no-direct-publish invariant, in CI with a stand-in model; `pnpm eval:agent` runs it against a real model (not run: needs a key).*

#### Deployment kit
- [ ] P5.19 Production Dockerfile for the site (in `templates/`) and images for platform services. *Dockerfiles for the platform, the dashboard and the docs site template (`dockudos init` copies it) are written. Their steps were checked by hand (`pnpm deploy` of the platform and the standalone dashboard both run), but no image has been built: there was no Docker daemon here. CI builds them.*
- [ ] P5.20 Docker Compose full stack (site, editor, analytics, auth, agent, hooks, postgres, storage, queue) with `.env.example`. *`deploy/compose` (Postgres, MinIO, migrate, api, worker, agent, site, editor, proxy) with health checks, `.env.example` and a smoke override. `docker compose config` accepts it and rejects a missing secret; it has not been started. CI starts it.*
- [x] P5.21 Helm chart for Kubernetes with values for scaling, ingress and secrets. *Chart with api, worker, agent, site and editor workloads, autoscaling, disruption budgets, ingress (dashboard + wildcard sites), existing-secret support, optional bundled Postgres and MinIO, network policy, `helm test`. `helm lint` passes and `pnpm verify:helm` renders it with several value sets and feeds every container's environment through the platform's own config loader.*
- [x] P5.22 Self-hosting docs: options matrix, env vars, backup/restore, upgrade guide, what you own. *Ten guides in `apps/docs` under Platform (overview, Compose, Kubernetes, connect a repository, editor, analytics, agent, teams and sign-in, operate it, configuration), a backup/restore command that is exercised, upgrade and monitoring notes, and what you own.*

### Acceptance criteria
- [ ] `cp .env.example .env && docker compose up -d` brings up the whole stack; health checks pass. *Not run: no Docker daemon was available. The same checks run against the production tree as a process (`pnpm verify:platform`) and CI runs the real stack.*
- [x] Pushing to a connected repository triggers a rebuild and the new content is live. *Browser test with an in-memory Git host and faked build commands (a signed webhook, a worker, the live site on its own host); the process-level smoke test does it against the production tree. Not run against GitHub or GitLab.*
- [ ] Editing a page in the editor creates a commit/PR in the Git repository and the live preview matches the built page. *The PR half is tested end to end. The preview is made with the same components but not the site's build-time plugins, so it is not guaranteed to match the built page for code highlighting, math or diagrams.*
- [x] Analytics records a page view, a zero-result search and feedback with no personal data stored by default. *Unit tests assert the stored rows hold no address, agent, query string or referrer path; the smoke test does the same through the HTTP API.*
- [x] The agent opens a PR against the docs repo for a sample code change; it never pushes to the default branch. *`agent.spec.ts` and the evaluation set; every push is asserted to be on a `dockudos/agent-` branch.*
- [x] SSO login works with a test OIDC provider; role restrictions apply to private docs. *In-process provider with PKCE, state, nonce and signature checks; team membership restricting a docs site's rule through the real access guard. Not run against a hosted identity provider.*
- [ ] Helm chart installs on a local cluster (kind/minikube) and passes smoke tests. *Not run: no cluster. The CI job `Helm install on kind` does it; `helm lint` and `pnpm verify:helm` pass here.*
- [x] Backup and restore of Postgres and storage is documented and exercised once. *`pnpm verify:platform` backs up the production tree (database and objects), restores into a second empty database and checks the same API key and the analytics. The restore path is the platform's own; `pg_dump` is documented but not exercised.*

### Tests
- [x] Unit: webhook signature verification (valid, invalid, replay), job retry/idempotency, Git provider adapters (mocked), analytics privacy transforms (IP truncation), role permission checks. *`webhooks.spec.ts`, `queue.spec.ts`, `git.spec.ts`, `analytics.spec.ts`, `auth.spec.ts`.*
- [ ] Integration (Docker Compose): webhook -> build -> artifact -> live site; editor save -> commit; analytics ingest -> dashboard query; auth login -> protected docs. *Done in process rather than in Compose (`http.spec.ts`, `http-routes.spec.ts`, the browser tests, `private-docs.spec.ts`). The Compose run itself is a CI job that has not been run.*
- [x] Agent eval: expected-pages hit rate and "no direct publish" invariant. *Recall and precision at least 0.9, quiet cases quiet, zero direct publishes.*
- [x] E2E: editor create/edit/delete page; dashboard renders seeded data. *11 Playwright tests against a real platform (PGlite, in-memory Git host, real workers) behind the built dashboard.*
- [ ] Helm: `helm lint` and a kind-based install test in CI. *`helm lint` and the render checks pass; the kind job is written and has not been run.*
- [ ] Security: secrets not logged, SSRF protection on any URL fetch, rate limits, dependency audit; `security-auditor` review before release. *Secrets scrubbing, the SSRF guard, rate limits and the audit are done (see `notes/security/phase-5-platform.md`: no advisories in the platform; the other apps' Next 16.1 is flagged). The independent `security-auditor` review has not happened.*

## Moved to the enterprise plan

Former 5B (P5.23-P5.34: multi-tenancy, onboarding, hosting, domains, previews, managed AI, billing, operations, compliance, migration, pricing) is now E.1-E.13 in [../enterprise/plan.md](../enterprise/plan.md).
