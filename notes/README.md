# dockudos

**An AI-native documentation platform you can fully self-host.**

dockudos turns a folder of MDX files into a complete documentation site, built on Next.js. Visitors can search, ask questions and get cited answers, or describe what they need and be taken straight to the right page and heading. AI tools such as coding assistants can read the docs too, through `llms.txt` and an MCP server.

Everything in this repository is open source and self-hostable. A paid managed cloud and enterprise tier, built in a separate private repository ([enterprise/](./enterprise/README.md)), run it for teams that would rather not operate it themselves.

> **Status: design stage.** Nothing is built yet. This document set describes the intended product and architecture. Package names, config keys and APIs shown here are proposals and may change. See [development.md](./development.md) for the build plan.

---

## Why dockudos

| Problem | How dockudos approaches it |
| --- | --- |
| Hosted docs platforms (Mintlify and similar) lock you into their service | Fully open source and self-hostable, including the editor, analytics and AI agent |
| Open-source docs frameworks (Nextra, Fumadocs) treat AI as an add-on | AI querying, AI navigation, `llms.txt` and MCP are part of the core |
| Teams want to own their data and LLM choice | Bring your own LLM key, bring your own search backend, run everything on your infrastructure |
| Running docs infrastructure is a chore | An optional paid cloud ([enterprise](./enterprise/README.md)) handles hosting, updates, backups and support |

## Core ideas

1. **AI-native, not AI-added.** The content index is built for retrieval from day one. The same index powers keyword search, semantic search, the "Ask the docs" assistant, AI navigation, `llms.txt` and the MCP server.
2. **Self-hostable by default.** Every feature in this repository works on your own infrastructure. The paid cloud and enterprise tier sell operations, scale and compliance, never a feature taken from the open-source side.
3. **Next.js underneath.** You wrap your Next.js config with `withDocs()` and write MDX in a `docs/` folder. App Router only.
4. **Headless core, replaceable UI.** Config, page tree, content index and AI logic live in a UI-free core, so teams can use the default theme or build their own frontend.
5. **Open core.** The library and platform services are open source (Apache 2.0 proposed). The managed cloud and enterprise tier are a separate private repository that consumes the published packages. Their notes are in [enterprise/](./enterprise/README.md).

## A quick look (proposed API)

Install and scaffold:

```bash
npx dockudos init
```

Wrap your Next.js config:

```js
// next.config.mjs
import { withDocs } from "@dockudos/next";

export default withDocs({
  // your normal Next.js config
});
```

Describe navigation and theme:

```json
// docs.json
{
  "name": "Acme Docs",
  "theme": { "primary": "#4f46e5", "defaultMode": "system" },
  "navigation": [
    { "group": "Get started", "pages": ["index", "quickstart"] },
    { "group": "Guides", "pages": ["guides/auth", "guides/webhooks"] }
  ],
  "ai": { "provider": "openai", "model": "gpt-4o-mini" }
}
```

Write a page:

````mdx
---
title: Authentication
description: Sign requests with an API key.
---

<Callout type="info">Keys are scoped per project.</Callout>

<Steps>
  <Step title="Create a key">Open **Settings → API keys**.</Step>
  <Step title="Send it">Pass it in the `Authorization` header.</Step>
</Steps>

```ts
await fetch("https://api.acme.dev/v1/me", {
  headers: { Authorization: `Bearer ${process.env.ACME_KEY}` },
});
```
````

Run it:

```bash
pnpm dev     # local site with search and AI
pnpm build   # production build and content index
```

## What it includes

| Area | Highlights |
| --- | --- |
| Authoring | MDX, Accordion, Tabs, Steps, Cards, Callouts, Code Groups, Tooltips, Mermaid, Math |
| Site | Sidebar, table of contents, previous/next, redirects, dark mode, Shiki code highlighting |
| Search | Cmd+K palette, keyword search, semantic search, pluggable backends |
| AI | "Ask the docs" assistant with citations, AI navigation, `llms.txt`, MCP server |
| API docs | OpenAPI, AsyncAPI and GraphQL generation, interactive playground |
| Scale | Versioning, multi-language, changelog with RSS, feedback, private docs, static export |
| Platform | Web editor with Git sync, analytics, SSO, AI agent that opens doc-update pull requests |
| Enterprise (paid, separate repo) | Managed hosting, custom domains, previews, managed AI, SAML SSO, audit logs, SLAs, support. See [enterprise/](./enterprise/README.md) |

Full detail is in [features.md](./features.md).

## Document set

| File | What it covers |
| --- | --- |
| [README.md](./README.md) | This overview |
| [features.md](./features.md) | Every feature, grouped by area and phase |
| [architecture.md](./architecture.md) | Packages, build pipeline, runtime flows, extension points |
| [ai.md](./ai.md) | How AI querying, AI navigation, `llms.txt` and MCP work |
| [getting-started.md](./getting-started.md) | The intended developer workflow, step by step |
| [self-hosting-and-cloud.md](./self-hosting-and-cloud.md) | Self-hosting options and platform services |
| [enterprise/](./enterprise/README.md) | The paid side, built in a separate private repo: features, cloud, plan |
| [development.md](./development.md) | Monorepo, tooling, testing, release, roadmap and open questions |

## Who it is for

- Developer-tool and API companies that want Mintlify-level features without vendor lock-in
- Open-source maintainers who want great docs with built-in AI help
- Teams with data-residency or compliance needs that require self-hosting
- Teams that want a hosted option later without migrating

## Positioning

| | dockudos | Nextra / Fumadocs | Mintlify |
| --- | --- | --- | --- |
| Open source and self-hostable | Yes | Yes | No (hosted platform) |
| Built on Next.js | Yes | Yes | No |
| AI assistant and navigation in core | Yes | Varies; to verify | Yes (cloud) |
| Paid managed hosting | Yes (planned, separate repo) | No | Yes |

dockudos borrows ideas and feature behavior from existing tools such as Mintlify and Fumadocs. It does not copy their code, branding or design assets.

## License

Proposed: Apache 2.0 for the open-source repository. See the open questions in [development.md](./development.md).
