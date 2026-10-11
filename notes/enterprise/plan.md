# Enterprise plan

**Goal:** a team can connect a repository, get a live site on their own domain, and pay for it without talking to us. Large organizations can add SAML SSO, audit logs, SLAs and dedicated support.

**Lives in:** a separate private repository consuming the published `@dockudos/*` packages and platform images. See [README.md](./README.md) for the boundary.

**Depends on:** Phases 1-4 and Phase 5A in [../plan/phase-5-platform-and-cloud.md](../plan/phase-5-platform-and-cloud.md). Start only once there is real self-hosted usage to convert.

Conventions are the same as in [../plan/README.md](../plan/README.md): `[ ]` not started, `[x]` done with evidence. Task IDs are `E.<n>`. (E.1-E.11 were P5.23-P5.33 and E.13 was P5.34 in the open-source Phase 5 plan.)

## Tasks

#### Foundation
- [ ] E.1 Private repo scaffold consuming published `@dockudos/*` packages and platform images.
- [ ] E.2 Multi-tenant model: orgs, projects, sites, isolation of data, builds and secrets.

#### Hosting
- [ ] E.3 One-click onboarding: connect GitHub/GitLab, detect `docs/` and `docs.json`, first build.
- [ ] E.4 Hosting: build pipeline, CDN and caching, atomic deploys, rollbacks.
- [ ] E.5 Custom domains with managed SSL certificates and verification flow.
- [ ] E.6 Preview deployments per branch/PR with URL commented on the PR.

#### AI and billing
- [ ] E.7 Managed AI: hosted LLM and embeddings, vector store (`VectorStore` interface), per-site token budgets and rate limits.
- [ ] E.8 Billing: plans (per site or seat for hosting, usage-based for AI), checkout, invoices, usage metering, dunning, plan limits enforced.

#### Operations and compliance
- [ ] E.9 Operations: monitoring, alerting, backups, status page, support tooling, incident runbooks.
- [ ] E.10 Security and compliance: region selection (planned), data retention policy, privacy policy, terms, SLAs and support process; assess compliance needs.
- [ ] E.11 Migration both ways: import a self-hosted repo with no content conversion; export path documented (no lock-in).

#### Enterprise tier
- [ ] E.12 SAML SSO and audit logs, built on the open-source auth service and its extension points.
- [ ] E.13 Pricing validation with early users before enabling paid plans.

## Acceptance criteria

- [ ] A new team signs up, connects a repository, adds a custom domain with SSL, and has a live site without contacting us.
- [ ] They can subscribe and pay with no human intervention; usage-based AI charges match metered usage.
- [ ] Every PR gets a working preview URL; production deploys are atomic and can be rolled back.
- [ ] Tenant isolation: tenant A cannot read tenant B's content, index, analytics or secrets (tested).
- [ ] A site moved from self-hosted to cloud and back works with unchanged content.
- [ ] Uptime monitoring, alerts, backups and a restore drill are in place.
- [ ] SAML login works against a test IdP; audit logs record admin changes and private-doc access and can be exported.
- [ ] The open-source repo builds and passes its tests with no reference to the private repo.

## Tests

- [ ] Unit: billing/metering math, plan limit enforcement, domain verification logic, SAML assertion validation, audit-log writes.
- [ ] Integration: signup -> connect repo -> build -> deploy -> domain -> paid plan (against Stripe test mode and a test DNS/cert provider).
- [ ] Tenant-isolation tests across API, storage, search/AI retrieval and analytics.
- [ ] Load test: concurrent builds and AI questions within budget; rate limiting verified.
- [ ] Restore drill and rollback drill scripted and run.
- [ ] Penetration-style review before general availability.
