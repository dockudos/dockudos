# The managed cloud

A hosted version of the same platform, run by the dockudos team. Built in the private enterprise repo (see [README.md](./README.md)). The open-source side, including how to self-host, is in [../self-hosting-and-cloud.md](../self-hosting-and-cloud.md).

> **Status:** planned. Pricing is not decided.

## 1. What you get

| Capability | Description |
| --- | --- |
| One-click hosting | Connect a GitHub or GitLab repository and get a live site |
| Custom domains and SSL | Managed certificates, CDN and caching |
| Preview deployments | A preview URL for every branch or pull request |
| Managed AI | A hosted assistant, embeddings and vector store. No LLM keys to manage. |
| Automatic updates | New versions without you doing anything |
| Backups, scaling, uptime | Monitored and managed |
| Support | Help from the team |

## 2. Typical flow

1. Sign up and connect a repository.
2. dockudos detects the docs folder and `docs.json` and builds the site.
3. Add a custom domain.
4. Every push deploys automatically. Pull requests get preview URLs.

## 3. Moving between self-hosted and cloud

Your content stays in your Git repository, in plain MDX and `docs.json`. Moving between self-hosting and the cloud means changing where it deploys, not converting content. That is the main promise of the open-core model: no lock-in.

## 4. Pricing (not decided)

Leaning, to be validated with early users (task E.13 in [plan.md](./plan.md)).

| Dimension | Leaning |
| --- | --- |
| Hosting and support | Per site or per seat |
| Managed AI | Usage-based, since LLM cost scales with questions |
| Self-hosting | Free |
| Enterprise tier | SAML SSO, audit logs, SLAs and dedicated support as an add-on |

## 5. Security and compliance

| Topic | Self-host | Cloud |
| --- | --- | --- |
| Data location | Your infrastructure | Region selectable (planned) |
| LLM provider | Your choice and key | Managed, with a documented provider list |
| Content retention | You decide | Defined in the privacy policy |
| Private docs | Access control applied at retrieval and rendering | Same |
| Compliance | Your responsibility | To be assessed as the cloud matures |

## 6. Risks

| Risk | Why it matters | Response |
| --- | --- | --- |
| A separate business | Hosting, support and billing have their own costs | Start only after real self-hosted usage exists |
| LLM cost | Usage can spike | Rate limits, caching, token budgets |
| Tenant isolation | A leak between tenants is fatal | Isolation tests across API, storage, retrieval and analytics before launch |
