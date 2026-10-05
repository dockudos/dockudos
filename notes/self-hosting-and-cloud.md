# Self-hosting and the managed cloud

dockudos is fully open source and self-hostable. A paid managed cloud runs the same software for teams that would rather not operate it. This document explains both paths and what you pay for.

> **Status:** planned. The deployment kit and cloud are Phase 5 work. Pricing is not decided.

## 1. The model in one table

Everything is open source and self-hostable. The cloud sells operations, not exclusive features.

| | Self-host (free) | Managed cloud (paid) |
| --- | --- | --- |
| Library, CLI, components, theming, search | Yes | Yes |
| AI assistant and AI navigation | Yes, bring your own LLM key | Yes, we run the AI infrastructure |
| API reference, versioning, i18n, changelog | Yes | Yes |
| Web editor with Git sync | Yes | Yes |
| Analytics and feedback dashboards | Yes | Yes |
| AI agent that opens doc-update pull requests | Yes | Yes |
| SSO, teams, roles, private docs | Yes | Yes |
| Hosting, custom domains, SSL, CDN | You run it (Docker, Vercel, Node, Cloudflare) | One-click |
| Preview deployments per branch | Via your own CI | Built in |
| Updates, backups, scaling, uptime, support | You handle it | We handle it |

## 2. Self-hosting options

Pick the lightest option that covers the features you need.

| Option | Pages | Search | AI features | Platform services | Effort |
| --- | --- | --- | --- | --- | --- |
| Static export on any static host | Yes | Keyword, in the browser | No (needs a server or external endpoint) | No | Lowest |
| Vercel, Netlify or similar | Yes | Yes | Yes (serverless functions) | Optional, run separately | Low |
| Node server (`next start`) | Yes | Yes | Yes | Optional | Medium |
| Docker image | Yes | Yes | Yes | Yes, with Compose | Medium |
| Docker Compose full stack | Yes | Yes | Yes | Yes: editor, analytics, auth, agent, hooks | Higher |
| Kubernetes with the Helm chart | Yes | Yes | Yes | Yes, scalable | Highest |

### Minimal: docs site only

```bash
pnpm build
pnpm start          # or deploy the build to your host
```

Environment variables (names are proposed):

| Variable | Purpose |
| --- | --- |
| `DOCKUDOS_LLM_API_KEY` | LLM provider key for the assistant and AI navigation |
| `DOCKUDOS_EMBEDDINGS_API_KEY` | Embedding provider key, if semantic search is on |
| `DOCKUDOS_SITE_URL` | Public URL, used for sitemap, OG images and llms.txt |
| `DOCKUDOS_AUTH_SECRET` | Session secret, if private docs are on |

### Docker

A Dockerfile in the template builds the site into a small production image.

```bash
docker build -t my-docs .
docker run -p 3000:3000 --env-file .env my-docs
```

### Full stack with Docker Compose

Compose runs the site plus the platform services and their dependencies.

```
services:
  site         # the Next.js docs site
  editor       # web editor
  analytics    # event ingestion and dashboards
  auth         # SSO, teams, roles
  agent        # AI agent and automations
  hooks        # GitHub and GitLab webhooks
  postgres     # application data
  storage      # object storage for uploads (S3-compatible)
  queue        # job queue for builds and agent runs
```

```bash
cp .env.example .env
docker compose up -d
```

A Helm chart provides the same stack for Kubernetes.

### Requirements for the full stack

| Need | Notes |
| --- | --- |
| Postgres | Application data, analytics, users |
| S3-compatible storage | Uploads and build artifacts |
| A Git provider | GitHub or GitLab, for the editor, hooks and agent |
| An LLM provider key | For AI features |
| A reverse proxy or ingress | TLS and routing |

### What you own when you self-host

- Updates and security patches
- Backups of Postgres and storage
- Scaling, uptime monitoring and incident response
- LLM spend and rate limits
- TLS certificates and domains

## 3. Platform services

Open source, run on your infrastructure.

| Service | What it does |
| --- | --- |
| **Editor** | Visual Markdown and MDX editor with live preview. Edits are commits in your Git repository, so files stay the source of truth. |
| **Analytics** | Page views, search queries (including ones with no results), feedback, assistant conversations, and traffic from humans versus AI tools. |
| **Auth and teams** | SSO (OAuth/OIDC, SAML), teams, roles, and access control for private docs. |
| **AI agent** | Watches code and docs repositories and opens pull requests that update docs. Runs scheduled automations. Humans review and merge. |
| **Hooks** | Receives GitHub and GitLab webhooks and rebuilds on every push. |

## 4. The managed cloud

### What it is

A hosted version of the same platform, run by the dockudos team. It lives in a separate private repository that depends on the published open-source packages, so the free and paid sides stay cleanly separated.

### What you get

| Capability | Description |
| --- | --- |
| One-click hosting | Connect a GitHub or GitLab repository and get a live site |
| Custom domains and SSL | Managed certificates, CDN and caching |
| Preview deployments | A preview URL for every branch or pull request |
| Managed AI | A hosted assistant, embeddings and vector store. No LLM keys to manage. |
| Automatic updates | New versions without you doing anything |
| Backups, scaling, uptime | Monitored and managed |
| Support | Help from the team |

### Typical flow

1. Sign up and connect a repository.
2. dockudos detects the docs folder and `docs.json` and builds the site.
3. Add a custom domain.
4. Every push deploys automatically. Pull requests get preview URLs.

### Moving between self-hosted and cloud

Your content stays in your Git repository, in plain MDX and `docs.json`. Moving between self-hosting and the cloud means changing where it deploys, not converting content. That is the main promise of the open-core model: no lock-in.

## 5. Pricing (not decided)

Leaning, to be validated with early users.

| Dimension | Leaning |
| --- | --- |
| Hosting and support | Per site or per seat |
| Managed AI | Usage-based, since LLM cost scales with questions |
| Self-hosting | Free |
| Enterprise | SSO, audit logs, SLAs and dedicated support as an add-on tier |

Open question: whether any enterprise-only features (for example audit logs) should be paid-only, or whether everything should stay open source and enterprise should pay only for support and SLAs. The current direction is the latter.

## 6. Security and compliance

| Topic | Self-host | Cloud |
| --- | --- | --- |
| Data location | Your infrastructure | Region selectable (planned) |
| LLM provider | Your choice and key | Managed, with a documented provider list |
| Content retention | You decide | Defined in the privacy policy |
| Private docs | Access control applied at retrieval and rendering | Same |
| Compliance | Your responsibility | To be assessed as the cloud matures |

## 7. Decision guide

| If you... | Choose |
| --- | --- |
| Want a simple docs site with search and no AI | Static export |
| Want the AI features on a platform you already use | Vercel or Node |
| Need data to stay in your network | Docker Compose or Helm |
| Want editor, analytics and agent without operating them | Managed cloud |
| Are not sure yet | Start self-hosted; move to the cloud later without changing content |
