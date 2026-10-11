# Getting started

The intended developer workflow for dockudos, from an empty folder to a deployed site.

> **Status:** planned workflow. Commands, file names and config keys are proposals. Nothing is published to npm yet.

## Requirements

- Node.js 20 or newer
- pnpm, npm or yarn
- A Next.js App Router project (new or existing)
- Optional: an LLM API key, to turn on the AI features

## 1. Create a site

### New project

```bash
npx dockudos init my-docs
cd my-docs
pnpm install
pnpm dev
```

`init` asks a few questions (site name, package manager, whether to enable AI) and scaffolds the project.

### Existing Next.js project

```bash
pnpm add @dockudos/next @dockudos/ui @dockudos/core
```

Wrap your config:

```js
// next.config.mjs
import { withDocs } from "@dockudos/next";

export default withDocs({
  // your existing Next.js config
});
```

## 2. Project layout

```
my-docs/
├── docs/
│   ├── index.mdx
│   ├── quickstart.mdx
│   └── guides/
│       ├── auth.mdx
│       └── webhooks.mdx
├── public/
│   └── logo.svg
├── docs.json
├── next.config.mjs
└── package.json
```

- Every `.mdx` file under `docs/` becomes a page. The file path becomes the URL.
- `docs.json` controls navigation, theme and features.
- `public/` holds images and static files.

## 3. Write a page

````mdx
---
title: Webhooks
description: Receive events from Acme.
---

## Register an endpoint

<Steps>
  <Step title="Add a URL">Go to **Settings → Webhooks** and add your endpoint.</Step>
  <Step title="Choose events">Select the events you want to receive.</Step>
</Steps>

<Callout type="warning">
  Verify the signature on every request.
</Callout>

<CodeGroup>
```ts title="Node"
app.post("/hooks", verifySignature, handler);
```
```py title="Python"
@app.post("/hooks")
def hooks(): ...
```
</CodeGroup>
````

### Built-in components

| Component | Use |
| --- | --- |
| `Callout` | Notes, info, warnings, danger |
| `Steps` | Numbered procedures |
| `Tabs` | Alternative content, such as languages or platforms |
| `CodeGroup` | The same example in several languages |
| `Accordion` | Collapsible FAQs |
| `Cards` | Link grids on landing pages |
| `Tooltip` | Inline definitions |
| `Files` | File-tree illustrations |
| `Mermaid` | Diagrams written as text |

## 4. Configure navigation and theme

```json
{
  "name": "Acme Docs",
  "logo": { "light": "/logo.svg", "dark": "/logo-dark.svg" },
  "theme": {
    "primary": "#4f46e5",
    "defaultMode": "system",
    "layout": "docs"
  },
  "navigation": [
    {
      "tab": "Guides",
      "groups": [
        { "group": "Get started", "pages": ["index", "quickstart"] },
        { "group": "Build", "pages": ["guides/auth", "guides/webhooks"] }
      ]
    }
  ],
  "redirects": [{ "from": "/old-auth", "to": "/guides/auth" }]
}
```

Invalid config fails the build with a message that names the key and the problem.

## 5. Turn on AI

Add an `ai` block to `docs.json`:

```json
{
  "ai": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```

Set your key on the server, never in the repository:

```bash
# .env.local
DOCKUDOS_LLM_API_KEY=your-key-here
```

What you get:

- **Ask the docs** and **AI navigation** in the Cmd+K palette
- `llms.txt` and `llms-full.txt`
- An MCP endpoint your coding tools can connect to

Without a key, keyword search, `llms.txt` and the MCP search tools still work. Only the generated answers and AI navigation need an LLM. To add semantic search, also configure an embedding provider (see [ai.md](./ai.md)).

## 6. Add API reference (optional)

```json
{
  "openapi": {
    "sources": [{ "name": "Acme API", "spec": "./openapi.json", "path": "/api" }],
    "playground": true
  }
}
```

The build generates a page per endpoint with parameters, responses, code samples and a playground.

## 7. Everyday commands

```bash
pnpm dev                 # dev server with live reload
pnpm build               # production build, index and llms.txt
pnpm start               # serve the production build
npx dockudos broken-links  # check internal and external links
```

## 8. Deploy

| Target | How |
| --- | --- |
| Vercel or similar | Connect the repository and set the env vars. AI endpoints run as serverless functions. |
| Node server | `pnpm build && pnpm start` behind your reverse proxy |
| Docker | Use the provided Dockerfile (see [self-hosting.md](./self-hosting.md)) |
| Static hosting | Use `dockudos build --static`. Pages and keyword search work; AI, feedback and `access` rules need a server (see the Static export guide) |
| Managed cloud | Connect the repository and get a live site on your domain. Paid, built in a separate repo. See [enterprise/cloud.md](./enterprise/cloud.md) |

## 9. Troubleshooting (expected)

| Symptom | Likely cause |
| --- | --- |
| Build fails with a config error | `docs.json` key is wrong or missing; the message names it |
| A page is not in the sidebar | It is not listed in `navigation` (or the folder-based sidebar is off) |
| "Ask the docs" does nothing | `ai.enabled` is false or the API key is not set on the server |
| Answers are vague or missing | The index is stale; rebuild, and check that the page is not excluded |
| Search finds nothing | Check that the page is published and not hidden in config |
| Static export has no AI | Expected: AI endpoints need a server |

## Next steps

- [features.md](./features.md) for everything you can turn on
- [ai.md](./ai.md) for how the AI features work and how to tune them
- [architecture.md](./architecture.md) if you want to extend or replace parts
