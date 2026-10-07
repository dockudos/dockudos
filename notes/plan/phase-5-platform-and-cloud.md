# Phase 5: Platform and cloud

**Goal:** the full platform is self-hostable (5A), then a paid managed cloud runs it for teams (5B).

**Depends on:** Phases 1-4. Per development.md, start only once there is real self-hosted usage to convert; 5B is effectively a separate business and lives in a **separate private repository** consuming the published packages.

**Done when** (development.md): a team can connect a repository, get a live site on their own domain, and pay for it without talking to us.

## 5A. Open-source platform (`apps/platform`, self-hostable)

### Tasks

#### Shared infrastructure
- [ ] P5.1 `apps/platform` scaffold (Nx), shared libs for DB access, config, logging; Postgres schema + migrations.
- [ ] P5.2 Job queue for builds and agent runs; S3-compatible object storage client for uploads and build artifacts.
- [ ] P5.3 Git provider abstraction (GitHub first, GitLab second): clone, commit, branch, open PR, webhooks.
- [ ] P5.4 Observability baseline: structured logs, health endpoints, basic metrics.

#### Auth and teams
- [ ] P5.5 SSO: OAuth/OIDC, then SAML; teams and roles; API keys.
- [ ] P5.6 Plug platform auth into Phase 4 private docs and the assistant/MCP token flow.

#### Hooks
- [ ] P5.7 GitHub and GitLab webhook receiver with signature verification; triggers rebuild on push; idempotent and retry-safe.
- [ ] P5.8 Build runner producing the site and index, storing artifacts, reporting status.

#### Editor
- [ ] P5.9 Visual Markdown/MDX editor with live preview using the real components.
- [ ] P5.10 Git-backed saves: edits become commits/PRs; files stay the source of truth; conflict handling.
- [ ] P5.11 Media upload, page/navigation management, `docs.json` form editing with schema validation.

#### Analytics
- [ ] P5.12 Event ingestion (page views, searches including zero-result, feedback, assistant conversations, human vs. AI-tool traffic).
- [ ] P5.13 Privacy defaults: no personal data, IP truncation, cookie-free counting; conversation logging opt-in with retention setting.
- [ ] P5.14 Dashboards: top pages, failed searches, feedback, assistant questions and unanswered topics.

#### AI agent
- [ ] P5.15 Change watcher on code and docs repos; map code changes to affected pages via the index.
- [ ] P5.16 Draft edits and open PRs (never publish directly); PR description explains why.
- [ ] P5.17 Scheduled automations (outdated pages, broken links); BYO LLM key for self-hosters.
- [ ] P5.18 Agent evaluation set: given a code diff, expected pages flagged and acceptable edits.

#### Deployment kit
- [ ] P5.19 Production Dockerfile for the site (in `templates/`) and images for platform services.
- [ ] P5.20 Docker Compose full stack (site, editor, analytics, auth, agent, hooks, postgres, storage, queue) with `.env.example`.
- [ ] P5.21 Helm chart for Kubernetes with values for scaling, ingress and secrets.
- [ ] P5.22 Self-hosting docs: options matrix, env vars, backup/restore, upgrade guide, what you own.

### Acceptance criteria (5A)
- [ ] `cp .env.example .env && docker compose up -d` brings up the whole stack; health checks pass.
- [ ] Pushing to a connected repository triggers a rebuild and the new content is live.
- [ ] Editing a page in the editor creates a commit/PR in the Git repository and the live preview matches the built page.
- [ ] Analytics records a page view, a zero-result search and feedback with no personal data stored by default.
- [ ] The agent opens a PR against the docs repo for a sample code change; it never pushes to the default branch.
- [ ] SSO login works with a test OIDC provider; role restrictions apply to private docs.
- [ ] Helm chart installs on a local cluster (kind/minikube) and passes smoke tests.
- [ ] Backup and restore of Postgres and storage is documented and exercised once.

### Tests (5A)
- [ ] Unit: webhook signature verification (valid, invalid, replay), job retry/idempotency, Git provider adapters (mocked), analytics privacy transforms (IP truncation), role permission checks.
- [ ] Integration (Docker Compose): webhook -> build -> artifact -> live site; editor save -> commit; analytics ingest -> dashboard query; auth login -> protected docs.
- [ ] Agent eval: expected-pages hit rate and "no direct publish" invariant.
- [ ] E2E: editor create/edit/delete page; dashboard renders seeded data.
- [ ] Helm: `helm lint` and a kind-based install test in CI.
- [ ] Security: secrets not logged, SSRF protection on any URL fetch, rate limits, dependency audit; `security-auditor` review before release.

## 5B. Managed cloud (separate private repo)

### Tasks
- [ ] P5.23 Private repo scaffold consuming published `@dockudos/*` packages and platform images.
- [ ] P5.24 Multi-tenant model: orgs, projects, sites, isolation of data, builds and secrets.
- [ ] P5.25 One-click onboarding: connect GitHub/GitLab, detect `docs/` and `docs.json`, first build.
- [ ] P5.26 Hosting: build pipeline, CDN and caching, atomic deploys, rollbacks.
- [ ] P5.27 Custom domains with managed SSL certificates and verification flow.
- [ ] P5.28 Preview deployments per branch/PR with URL commented on the PR.
- [ ] P5.29 Managed AI: hosted LLM and embeddings, vector store (`VectorStore` interface), per-site token budgets and rate limits.
- [ ] P5.30 Billing: plans (per site or seat for hosting, usage-based for AI), checkout, invoices, usage metering, dunning, plan limits enforced.
- [ ] P5.31 Operations: monitoring, alerting, backups, status page, support tooling, incident runbooks.
- [ ] P5.32 Security and compliance: region selection (planned), data retention policy, privacy policy, terms; assess compliance needs.
- [ ] P5.33 Migration both ways: import a self-hosted repo with no content conversion; export path documented (no lock-in).
- [ ] P5.34 Pricing validation with early users before enabling paid plans.

### Acceptance criteria (5B)
- [ ] A new team signs up, connects a repository, adds a custom domain with SSL, and has a live site without contacting us.
- [ ] They can subscribe and pay with no human intervention; usage-based AI charges match metered usage.
- [ ] Every PR gets a working preview URL; production deploys are atomic and can be rolled back.
- [ ] Tenant isolation: tenant A cannot read tenant B's content, index, analytics or secrets (tested).
- [ ] A site moved from self-hosted to cloud and back works with unchanged content.
- [ ] Uptime monitoring, alerts, backups and a restore drill are in place.

### Tests (5B)
- [ ] Unit: billing/metering math, plan limit enforcement, domain verification logic.
- [ ] Integration: signup -> connect repo -> build -> deploy -> domain -> paid plan (against Stripe test mode and a test DNS/cert provider).
- [ ] Tenant-isolation tests across API, storage, search/AI retrieval and analytics.
- [ ] Load test: concurrent builds and AI questions within budget; rate limiting verified.
- [ ] Restore drill and rollback drill scripted and run.
- [ ] Penetration-style review before general availability.
