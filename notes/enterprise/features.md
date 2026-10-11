# Enterprise features

Every paid feature, built in the private enterprise repo. The **Plan** column refers to tasks in [plan.md](./plan.md). Open-source features are in [../features.md](../features.md).

> **Status:** planned. Nothing here is built yet.

## 1. Managed hosting

| Feature | Description | Plan |
| --- | --- | --- |
| One-click hosting | Connect a GitHub or GitLab repository and get a live site | E.3, E.4 |
| Build pipeline | Builds on every push, atomic deploys, rollbacks | E.4 |
| Custom domains and SSL | Managed certificates, verification flow, CDN and caching | E.5 |
| Preview deployments | A preview URL per branch or pull request, linked on the PR | E.6 |
| Automatic updates | New dockudos versions without any action from the customer | E.9 |
| Scaling and uptime | Monitored and managed, with a status page | E.9 |
| Backups | Automatic, with tested restores | E.9 |

## 2. Multi-tenancy and accounts

| Feature | Description | Plan |
| --- | --- | --- |
| Orgs, projects, sites | Tenant model with isolation of data, builds, index, analytics and secrets | E.2 |
| Self-serve signup | Sign up, connect a repository and publish without contacting us | E.3 |
| Migration both ways | Import a self-hosted repository with no content conversion; documented export path | E.11 |

## 3. Managed AI

| Feature | Description | Plan |
| --- | --- | --- |
| Hosted assistant | "Ask the docs" and AI navigation with no LLM keys to manage | E.7 |
| Hosted embeddings and vector store | Implements the open-source `VectorStore` interface | E.7 |
| Budgets and limits | Per-site token budgets and rate limits | E.7 |
| Managed agent infrastructure | The open-source AI agent running on managed AI | E.7 |

## 4. Billing

| Feature | Description | Plan |
| --- | --- | --- |
| Plans | Per site or per seat for hosting, usage-based for AI | E.8 |
| Checkout and invoices | Self-serve payment, no human step | E.8 |
| Metering and limits | Usage metering, dunning, plan limits enforced | E.8 |

## 5. Enterprise tier (add-on)

| Feature | Description | Plan |
| --- | --- | --- |
| SAML SSO | SAML single sign-on, on top of the open-source OAuth/OIDC login | E.12 |
| Audit logs | Who changed what and who accessed which private docs, exportable | E.12 |
| SLAs | Uptime and response-time commitments | E.10 |
| Dedicated support | Named contact and escalation path | E.10 |
| Region selection | Choose where data is stored (planned) | E.10 |
| Data retention controls | Configurable retention for conversations and logs | E.10 |

## 6. Operations and support

| Feature | Description | Plan |
| --- | --- | --- |
| Support tooling | Internal tools for the support team | E.9 |
| Incident runbooks | Documented response for outages | E.9 |
| Security and compliance | Privacy policy, terms, retention policy, compliance assessment | E.10 |

## Out of scope for enterprise

- Moving any open-source feature behind a paywall.
- Lock-in. Content and configuration must remain exportable.
