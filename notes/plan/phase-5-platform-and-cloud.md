# Phase 5: Platform

**Goal:** the full platform is self-hostable. The paid managed cloud and enterprise tier are planned separately in [../enterprise/plan.md](../enterprise/plan.md) and built in a separate private repository.

**Depends on:** Phases 1-4. Per development.md, the enterprise work starts only once there is real self-hosted usage to convert.

**Done when:** a team can self-host the whole platform with `docker compose up`. (The "live site on their own domain, and pay without talking to us" check moved to the [enterprise plan](../enterprise/plan.md).)

## Open-source platform (`apps/platform`, self-hostable)

### Tasks

#### Shared infrastructure
- [ ] P5.1 `apps/platform` scaffold (Nx), shared libs for DB access, config, logging; Postgres schema + migrations.
- [ ] P5.2 Job queue for builds and agent runs; S3-compatible object storage client for uploads and build artifacts.
- [ ] P5.3 Git provider abstraction (GitHub first, GitLab second): clone, commit, branch, open PR, webhooks.
- [ ] P5.4 Observability baseline: structured logs, health endpoints, basic metrics.

#### Auth and teams
- [ ] P5.5 Auth: OAuth/OIDC; teams and roles; API keys. (SAML and audit logs are enterprise, task E.12.)
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

### Acceptance criteria
- [ ] `cp .env.example .env && docker compose up -d` brings up the whole stack; health checks pass.
- [ ] Pushing to a connected repository triggers a rebuild and the new content is live.
- [ ] Editing a page in the editor creates a commit/PR in the Git repository and the live preview matches the built page.
- [ ] Analytics records a page view, a zero-result search and feedback with no personal data stored by default.
- [ ] The agent opens a PR against the docs repo for a sample code change; it never pushes to the default branch.
- [ ] SSO login works with a test OIDC provider; role restrictions apply to private docs.
- [ ] Helm chart installs on a local cluster (kind/minikube) and passes smoke tests.
- [ ] Backup and restore of Postgres and storage is documented and exercised once.

### Tests
- [ ] Unit: webhook signature verification (valid, invalid, replay), job retry/idempotency, Git provider adapters (mocked), analytics privacy transforms (IP truncation), role permission checks.
- [ ] Integration (Docker Compose): webhook -> build -> artifact -> live site; editor save -> commit; analytics ingest -> dashboard query; auth login -> protected docs.
- [ ] Agent eval: expected-pages hit rate and "no direct publish" invariant.
- [ ] E2E: editor create/edit/delete page; dashboard renders seeded data.
- [ ] Helm: `helm lint` and a kind-based install test in CI.
- [ ] Security: secrets not logged, SSRF protection on any URL fetch, rate limits, dependency audit; `security-auditor` review before release.

## Moved to the enterprise plan

Former 5B (P5.23-P5.34: multi-tenancy, onboarding, hosting, domains, previews, managed AI, billing, operations, compliance, migration, pricing) is now E.1-E.13 in [../enterprise/plan.md](../enterprise/plan.md).
