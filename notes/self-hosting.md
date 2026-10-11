# Self-hosting

dockudos is fully open source and self-hostable. A paid managed cloud and enterprise tier, built in a separate private repository, run the same software for teams that would rather not operate it. This document covers self-hosting; the paid side is in [enterprise/](./enterprise/README.md).

> **Status:** planned. The deployment kit is Phase 5A work. The paid side is planned separately in [enterprise/plan.md](./enterprise/plan.md).

## 1. The model in one table

Everything in this repository is open source and self-hostable. The paid side sells operations, scale and compliance on top. See [enterprise/README.md](./enterprise/README.md).

| | Self-host (free) | Managed cloud (paid) |
| --- | --- | --- |
| Library, CLI, components, theming, search | Yes | Yes |
| AI assistant and AI navigation | Yes, bring your own LLM key | Yes, we run the AI infrastructure |
| API reference, versioning, i18n, changelog | Yes | Yes |
| Web editor with Git sync | Yes | Yes |
| Analytics and feedback dashboards | Yes | Yes |
| AI agent that opens doc-update pull requests | Yes | Yes |
| OAuth/OIDC login, teams, roles, private docs | Yes | Yes |
| SAML SSO, audit logs, SLAs, dedicated support | No (enterprise tier) | Enterprise add-on |
| Hosting, custom domains, SSL, CDN | You run it (Docker, Vercel, Node, Cloudflare) | One-click |
| Preview deployments per branch | Via your own CI | Built in |
| Updates, backups, scaling, uptime, support | You handle it | We handle it |

## 2. Self-hosting options

Pick the lightest option that covers the features you need.

| Option | Pages | Search | AI features | Platform services | Effort |
| --- | --- | --- | --- | --- | --- |
| Static export on any static host (`dockudos build --static`) | Yes | Keyword, in the browser | No | No | Lowest |
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
  auth         # OAuth/OIDC, teams, roles
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
| **Auth and teams** | OAuth/OIDC login, teams, roles, and access control for private docs. SAML and audit logs are in the [enterprise tier](./enterprise/features.md). |
| **AI agent** | Watches code and docs repositories and opens pull requests that update docs. Runs scheduled automations. Humans review and merge. |
| **Hooks** | Receives GitHub and GitLab webhooks and rebuilds on every push. |

## 4. The paid side

The managed cloud and enterprise tier live in a separate private repository: see [enterprise/](./enterprise/README.md). Content stays in plain MDX and `docs.json`, so moving between self-hosting and cloud changes where it deploys, not the content.

## 5. Decision guide

| If you... | Choose |
| --- | --- |
| Want a simple docs site with search and no AI | Static export |
| Want the AI features on a platform you already use | Vercel or Node |
| Need data to stay in your network | Docker Compose or Helm |
| Want editor, analytics and agent without operating them | [Managed cloud](./enterprise/cloud.md) |
| Are not sure yet | Start self-hosted; move to the cloud later without changing content |
