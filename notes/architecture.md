# Architecture

How dockudos is put together: the packages, how content becomes a site, what happens at runtime, and where you can extend it.

> **Status:** proposed design. Package names and APIs may change during implementation.

## 1. Design principles

1. **Headless core, replaceable UI.** Logic that is not about pixels lives in `core` and can be tested without React.
2. **One index, many consumers.** A single build-time content index powers search, the AI assistant, AI navigation, `llms.txt` and the MCP server.
3. **Everything pluggable at the edges.** LLM provider, embedding provider, search backend and content source are interfaces with default implementations.
4. **Static where possible, dynamic where needed.** Pages render statically. Only search-with-AI, the assistant and platform services need a server.
5. **App Router only.** One routing model keeps the wrapper small and future-proof.
6. **Open core boundary is a repository boundary.** Platform services are open source in the main repo. The managed cloud and enterprise tier are a separate private repo that depends on published packages (see [enterprise/](./enterprise/README.md)).

## 2. System overview

```
                        ┌────────────────────────────────────────────┐
   docs/*.mdx           │                 BUILD TIME                 │
   docs.json   ───────► │  parse config → compile MDX → page tree    │
   openapi.json         │  → extract headings & text → chunk         │
                        │  → (optional) embeddings → content index   │
                        └───────────────┬────────────────────────────┘
                                        │ emits
              ┌─────────────────────────┼──────────────────────────────┐
              ▼                         ▼                              ▼
       Static pages (HTML)     Content index (JSON +        llms.txt, llms-full.txt,
       sitemap, RSS, OG        optional vectors)            Markdown twins of pages
                                        │
                        ┌───────────────┴────────────────┐
                        │            RUNTIME             │
                        │  /api/search   /api/ask        │
                        │  /api/navigate /api/page       │
                        │  /mcp          (route handlers)│
                        └───────────────┬────────────────┘
                                        │
                     ┌──────────────────┼───────────────────┐
                     ▼                  ▼                   ▼
              Command palette     Ask-the-docs         AI coding tools
              (search + AI nav)   assistant widget     (MCP, llms.txt)
```

## 3. Packages

Planned monorepo layout (details in [development.md](./development.md)):

| Package | Role | Depends on |
| --- | --- | --- |
| `@dockudos/core` | Headless: config schema and validation, page tree, TOC, MDX pipeline, content index types and builder | none |
| `@dockudos/ui` | React components, layouts, theming, Shiki code blocks, command palette, assistant widget | `core` |
| `@dockudos/next` | `withDocs()` wrapper, route handlers, metadata, sitemap, OG images | `core`, `ui` |
| `@dockudos/search` | Index querying, keyword engine, backend adapters (Algolia, Meilisearch, Typesense, Orama, FlexSearch) | `core` |
| `@dockudos/ai` | Retrieval, answer generation, AI navigation, LLM and embedding provider adapters | `core`, `search` |
| `@dockudos/mcp` | MCP server exposing search and page content as tools | `core`, `search` |
| `@dockudos/openapi` | OpenAPI, AsyncAPI and GraphQL page generation, playground, code samples | `core`, `ui` |
| `@dockudos/cli` | `init`, `dev`, `build`, `broken-links` | `core`, `next` |
| `apps/platform` | Phase 5 services: editor, analytics, auth, agent, webhooks | the packages above |
| `apps/docs` | dockudos's own documentation, built with dockudos | the packages above |
| `apps/example` | Minimal site used for end-to-end tests | the packages above |

Early on, `search`, `mcp` and `openapi` can live inside `core` or `ai` and be split out when they need to stand alone. Fewer packages means less release overhead.

## 4. Build pipeline

Triggered by `dockudos build` (or `next build` through `withDocs()`).

1. **Load config.** Read `docs.json`, validate against the schema, and fail with clear messages.
2. **Discover content.** Walk the `docs/` folder (and any extra content sources) to list pages.
3. **Compile MDX.** Parse frontmatter, run remark and rehype plugins (headings, admonitions, code highlighting, Mermaid, math, includes, package-install tabs), produce React-renderable output.
4. **Build the page tree.** Combine config navigation with discovered pages. Resolve versions and locales.
5. **Extract searchable structure.** For each page, extract title, description, headings, plain text and anchors.
6. **Chunk.** Split each page into sections by heading, with a size cap. Each chunk keeps page path, heading path, anchor and text.
7. **Embed (optional).** If an embedding provider is configured, compute vectors for each chunk. The result is cached by content hash so unchanged chunks are not re-embedded.
8. **Write the index.** Emit the content index (chunks, metadata, optional vectors).
9. **Generate AI-facing outputs.** `llms.txt`, `llms-full.txt`, and a Markdown version of each page.
10. **Generate site outputs.** Sitemap, RSS, redirects, OG image routes.
11. **Check links.** Report broken internal links, optionally external ones.

### Content index shape (proposed)

```ts
interface ContentIndex {
  version: number;
  builtAt: string;
  pages: PageRecord[];
  chunks: ChunkRecord[];
}

interface PageRecord {
  path: string;          // "/guides/auth"
  title: string;
  description?: string;
  locale?: string;
  version?: string;
  headings: { id: string; text: string; depth: number }[];
}

interface ChunkRecord {
  id: string;            // stable hash of path + heading path + text
  pagePath: string;
  headingPath: string[]; // ["Authentication", "API keys"]
  anchor: string;        // "api-keys"
  text: string;
  vector?: number[];     // present when embeddings are enabled
}
```

## 5. Runtime flows

### 5.1 Page request

Pages are statically generated from compiled MDX. The server only renders them on demand when you use features that need it (private docs, versions behind auth).

### 5.2 Search

1. The palette sends the query to the search client.
2. The client queries the built-in keyword index in the browser, or calls `/api/search` for server-side and semantic search, or calls an external backend through an adapter.
3. Results are ranked and shown with page title, heading and a snippet.

### 5.3 Ask the docs

1. Browser sends the question (and optional conversation history) to `/api/ask`.
2. The server runs hybrid retrieval over the index: keyword score plus vector similarity if available.
3. Top chunks are assembled into a prompt, within a token budget.
4. The LLM provider streams an answer. The prompt requires citations by chunk id.
5. The response streams to the browser, with citations mapped back to page links and anchors.
6. If retrieval finds nothing relevant, the assistant says so rather than guessing.

### 5.4 AI navigation

1. Browser sends a natural-language request such as "how do I rotate an API key?" to `/api/navigate`.
2. The server retrieves candidate chunks and asks the model (or a ranking function) to choose the single best destination.
3. The response is a target `{ path, anchor, reason }`.
4. The client routes to that page and scrolls to the heading, optionally with a short explanation.

### 5.5 Machine access

- `/llms.txt` and `/llms-full.txt` are static files.
- Requests that prefer Markdown (`Accept: text/markdown` or a `.md` suffix) get the page's Markdown twin.
- `/mcp` exposes tools such as `search_docs` and `get_page`.

More detail on all of this is in [ai.md](./ai.md).

## 6. Configuration

`docs.json` is the single source of truth for site structure. Proposed top-level keys:

| Key | Purpose |
| --- | --- |
| `name`, `logo`, `favicon` | Branding |
| `theme` | Colors, fonts, default mode, layout |
| `navigation` | Tabs, groups, pages, external links |
| `versions` | Version list and default |
| `i18n` | Locales and default locale |
| `redirects` | Source to destination map |
| `search` | Backend selection and options |
| `ai` | Provider, model, embeddings, limits, enable/disable features |
| `openapi` | Spec sources and playground options |
| `analytics` | Hooks for feedback and events |
| `seo` | Defaults for metadata and OG images |

Secrets such as LLM keys are never stored in `docs.json`. They come from environment variables.

## 7. Extension points

| Interface | Default | Alternatives |
| --- | --- | --- |
| `LLMProvider` | Configurable adapter | Any provider with a streaming API, or a custom adapter |
| `EmbeddingProvider` | Off (keyword only) | Hosted or local embedding models |
| `SearchBackend` | Built-in index | Algolia, Meilisearch, Typesense, Orama Cloud, FlexSearch, custom |
| `ContentSource` | Local MDX files | Notion, Obsidian, Sanity, remote MDX, local HTML, custom |
| `VectorStore` | In-memory / file index | External vector database (platform, and the managed cloud in the enterprise repo) |
| MDX plugins | Built-in set | Any remark or rehype plugin |
| Components | Built-in set | Override any component by name |

## 8. Platform services (Phase 5)

Run as Docker services alongside the site. Each is optional.

| Service | Responsibility |
| --- | --- |
| `editor` | Web editor with live preview, commits to Git |
| `analytics` | Ingests page views, searches, feedback and assistant conversations into a database |
| `auth` | OAuth/OIDC, teams, roles and access control for private docs (SAML and audit logs are enterprise) |
| `agent` | Watches repositories and opens pull requests that update docs; runs scheduled automations |
| `hooks` | Receives GitHub and GitLab webhooks and triggers rebuilds |

Shared infrastructure: Postgres for application data, an object store for uploads, a job queue for builds and agent runs. Docker Compose and a Helm chart provide the one-command deployment.

## 9. Security considerations

| Risk | Mitigation |
| --- | --- |
| Prompt injection through docs content or user questions | Treat retrieved text as data in the prompt, never as instructions; require citations; restrict the assistant to answering from retrieved context; no tool access in the public assistant |
| LLM key exposure | Keys only on the server, from environment variables, never in client bundles or config files |
| Abuse and cost of AI endpoints | Per-IP and per-session rate limits, max question length, max output tokens, optional CAPTCHA |
| Private content leaking through search or AI | Access control is applied at retrieval time, so chunks a user cannot see are never retrieved |
| Playground sends requests with secrets | Requests run from the browser to the target API; secrets are not sent to dockudos servers |
| Supply chain | Locked dependencies, provenance on published packages, minimal runtime dependencies in `core` |
| Analytics privacy | No personal data by default; IP truncation and cookie-free counting where possible |

## 10. Performance goals (targets, not measurements)

| Goal | Target |
| --- | --- |
| Static page first load | Lighthouse performance 95+ on the default theme |
| Palette search latency | Under 100 ms for the built-in index on a 1,000-page site |
| First token of an AI answer | Under 2 seconds, depending on the provider |
| Incremental rebuild | Unchanged pages and chunks reused from cache |

## 11. Testing strategy

| Layer | Approach |
| --- | --- |
| `core` | Unit tests with Vitest: config validation, page tree, chunking |
| `ui` | Component tests and visual checks in light and dark mode |
| `ai` | Retrieval tests on a fixed corpus; answer-quality evaluation set that checks citations are correct and unanswerable questions are declined |
| `next` and `cli` | End-to-end tests on `apps/example` using Playwright |
| Platform | Integration tests with Docker Compose |
