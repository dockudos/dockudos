# dockudos Enterprise

The paid side of dockudos: the managed cloud and the enterprise tier. It is built in a **separate private repository** that consumes the published open-source `@dockudos/*` packages and platform images. These notes live here so the plan stays in one place, but nothing in this folder is implemented in the open-source repo.

> **Status:** planned. Starts only after Phase 5A (the self-hostable platform) has real usage. Pricing is not decided.

## The boundary

The open-core boundary is a repository boundary.

| | Open-source repo (this one) | Enterprise repo (private) |
| --- | --- | --- |
| Library, CLI, components, theming, search | Yes | Consumes |
| AI assistant, AI navigation, MCP, `llms.txt` | Yes (bring your own LLM key) | Consumes |
| API docs, versioning, i18n, changelog, private docs | Yes | Consumes |
| Platform services: editor, analytics, hooks, AI agent, OAuth/OIDC auth and teams | Yes, self-hostable | Consumes |
| Deployment kit (Dockerfile, Compose, Helm) | Yes | Consumes |
| Managed hosting, domains, previews, multi-tenancy, billing | No | Yes |
| Managed AI (hosted LLM, embeddings, vector store) | No | Yes |
| Enterprise tier: SAML SSO, audit logs, SLAs, dedicated support | No | Yes |

Rules:

1. **No feature moves out of the open-source repo.** Once shipped open, it stays open. Enterprise only adds things that are operations, scale or compliance concerns.
2. **Enterprise depends on open source, never the reverse.** The open-source repo has no import, build step or config key that needs the private repo.
3. **Content stays portable.** A site moves between self-hosted and enterprise by changing where it deploys, not by converting content (plain MDX and `docs.json`).
4. **Extension points are the seam.** Enterprise plugs in through interfaces the open repo already defines (`VectorStore`, `LLMProvider`, `EmbeddingProvider`, the auth service). If enterprise needs a new seam, add the interface to the open repo first.

## Document set

| File | What it covers |
| --- | --- |
| [README.md](./README.md) | This overview and the boundary |
| [features.md](./features.md) | Every enterprise feature |
| [cloud.md](./cloud.md) | How the managed cloud works, pricing leanings, security and compliance |
| [plan.md](./plan.md) | Task list, acceptance criteria and tests |

Related open-source notes: [self-hosting.md](../self-hosting.md), [architecture.md](../architecture.md), [plan/phase-5-platform-and-cloud.md](../plan/phase-5-platform-and-cloud.md).

## Open questions

- [ ] Which features, if any, beyond those in [features.md](./features.md) belong to the enterprise tier. The rule above (nothing moves out of open source) applies.
- [ ] Pricing model and plan limits (see [cloud.md](./cloud.md)).
- [ ] Name, hosting provider and region strategy for the cloud.
- [ ] Which compliance frameworks to pursue and when.
- [ ] Private repo license and contribution policy.
