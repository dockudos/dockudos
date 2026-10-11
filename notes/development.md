# Development guide

How dockudos will be built: repository layout, tooling, phases, testing, release, and open decisions.

> **Status:** plan. No code exists yet.

## 1. Repository and tooling

dockudos is a monorepo of packages that depend on each other and are versioned and tested together.

| Decision | Choice | Notes |
| --- | --- | --- |
| Package manager | pnpm workspaces | |
| Monorepo tool | **Nx** | Chosen for generators, project graph, affected-only CI and built-in release tooling. Turborepo is the fallback if Nx proves heavy. Packages are plain pnpm workspaces, so switching is cheap. |
| Language | TypeScript everywhere | |
| Package builds | tsc via Nx, or tsup | |
| Tests | Vitest (unit), Playwright (end-to-end) | |
| Framework | Next.js, App Router only | |
| Content | MDX, Shiki for highlighting, Tailwind for the default theme | |
| CI | GitHub Actions | |
| Release | `nx release` for versioning, changelogs and npm publishing | |

### Layout

```
dockudos/
├── packages/
│   ├── core/          # headless: config, page tree, MDX pipeline, index
│   ├── ui/            # components, layouts, theming, palette, widget
│   ├── next/          # withDocs() wrapper and route handlers
│   ├── search/        # keyword engine and backend adapters
│   ├── ai/            # retrieval, assistant, AI navigation, providers
│   ├── mcp/           # MCP server
│   ├── openapi/       # OpenAPI, AsyncAPI, GraphQL, playground
│   └── cli/           # init, dev, build, broken-links
├── apps/
│   ├── docs/          # dockudos's own docs, built with dockudos
│   ├── example/       # minimal site used for end-to-end tests
│   └── platform/      # editor, analytics, auth, agent, hooks (Phase 5)
├── templates/         # what `dockudos init` copies
├── nx.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Start with fewer packages. Merge `search`, `mcp` and `openapi` into `core` or `ai` until each needs to stand alone. Fewer packages means less release overhead.

The managed cloud and enterprise tier live in a **separate private repository** that consumes the published packages. Their notes are in [enterprise/](./enterprise/README.md).

## 2. Setting up the workspace (PowerShell)

Requires Node 20+ and pnpm.

```powershell
npx create-nx-workspace@latest dockudos --preset=ts --pm=pnpm --nxCloud=skip
cd dockudos
pnpm add -D @nx/js @nx/next @nx/vite tsup

pnpm nx g @nx/js:lib packages/core --publishable --importPath=@dockudos/core --bundler=tsc --unitTestRunner=vitest
pnpm nx g @nx/js:lib packages/next --publishable --importPath=@dockudos/next --bundler=tsc --unitTestRunner=vitest
pnpm nx g @nx/js:lib packages/cli  --publishable --importPath=@dockudos/cli  --bundler=tsc --unitTestRunner=vitest

pnpm nx g @nx/next:app apps/example --style=css --e2eTestRunner=none --appDir=true
pnpm install
```

Link packages by adding `"@dockudos/core": "workspace:*"` to the dependent package's `package.json`.

Everyday commands:

```powershell
pnpm nx run-many -t build
pnpm nx run-many -t test
pnpm nx dev example
pnpm nx graph
pnpm nx affected -t build,test
pnpm nx reset
```

Nx flags change between versions. If one is rejected, run the command with `--help`.

## 3. Build phases

| Phase | Goal | Deliverables |
| --- | --- | --- |
| **1. Core library (MVP)** | `npx dockudos init` gives a polished docs site in minutes | `withDocs()`, MDX pipeline, `docs.json` schema, core components, sidebar, TOC, redirects, dark mode, Shiki, SEO, CLI (`init`, `dev`, `build`, `broken-links`), headless core, extra components and MDX plugins, layouts |
| **2. Search and AI** | Visitors can find or ask for anything; AI tools can read the docs | Content index, keyword search, Cmd+K palette, `llms.txt`, assistant with citations, AI navigation, pluggable providers, embeddable widget, semantic search, page-content endpoint, MCP server, pluggable search backends |
| **3. API docs** | A spec becomes an interactive API reference | OpenAPI, AsyncAPI, GraphQL generation, playground, code samples, hosted spec URLs, docs from TypeScript and Python |
| **4. Content at scale** | Docs for multiple versions, languages and audiences | Versioning, i18n, changelog and RSS, custom layouts, feedback, private docs and access control, static export, OG images, PDF/EPUB export, extra content sources |
| **5. Platform** | Full platform self-hostable | Editor, analytics, auth, AI agent, hooks, Docker Compose, Helm |

### Done-when checks

| Phase | Done when |
| --- | --- |
| 1 | A new project builds with zero config beyond the docs folder, and all components render in light and dark mode |
| 2 | A question about any documented topic returns an answer with working citations, and the palette navigates to the right heading for a natural-language request |
| 3 | A real-world OpenAPI spec renders every endpoint, and the playground can call a live test API |
| 4 | One docs site serves two versions in two languages, with a changelog feed and a private section behind login |
| 5 | A team can self-host the whole platform with `docker compose up`. (The paid-cloud check, "live site on their own domain, and pay without talking to us", is in [enterprise/plan.md](./enterprise/plan.md).) |

### Sequencing

Ship the open-source library first to build adoption. Build the enterprise repo (managed cloud and enterprise tier) once people are self-hosting and asking for it.

1. Phase 1 and publish to npm
2. Phase 2, the headline differentiator
3. Phase 3, then Phase 4, driven by what early users ask for
4. Phase 5, once there is real self-hosted usage to convert; then the [enterprise](./enterprise/plan.md) repo

## 4. Suggested first build steps

1. Scaffold the workspace (section 2).
2. `core`: config schema and validation, a minimal page tree.
3. `next`: `withDocs()` that compiles one MDX file into a page.
4. `apps/example`: one MDX page rendering end to end.
5. `ui`: sidebar, TOC, theme, code block.
6. `cli`: `init`, `dev`, `build`.
7. Add the content index and keyword search. Then the assistant.

Each step ends with a passing build and a test.

## 5. Testing

| Layer | Approach |
| --- | --- |
| `core` | Unit tests: config validation, page tree, chunking, index building |
| `ui` | Component tests; visual checks in light and dark mode |
| `ai` | Retrieval tests on a fixed corpus; an evaluation set for citation validity, refusals and navigation accuracy |
| `next` and `cli` | End-to-end tests on `apps/example` with Playwright |
| Platform | Integration tests with Docker Compose |
| CI | `nx affected` runs build, lint, test and e2e on every pull request |

## 6. Release process

- Conventional commits, with versions and changelogs generated by `nx release`.
- Packages published to npm with provenance.
- A dry run (`nx release --dry-run`) precedes every real release.
- Pre-1.0 versions may break APIs between minors; changes are documented in the changelog.

## 7. Contributing (planned)

- Open an issue before large changes.
- Keep pull requests small and focused.
- New features need tests and docs (docs live in `apps/docs`, built with dockudos itself).
- Be kind. A code of conduct will be added with the first public release.

## 8. Key decisions

| Decision | Options | Leaning |
| --- | --- | --- |
| License | Apache 2.0 (max adoption) vs AGPL or source-available (protects against resellers) | Apache 2.0 |
| Repo architecture | Monorepo for library, CLI, examples and platform; separate private repo for the managed cloud and enterprise tier | As stated |
| Router support | App Router only vs also Pages Router | App Router only |
| LLM provider | Pluggable vs one vendor | Pluggable |
| Retrieval | Keyword first, embeddings later vs embeddings from day one | Keyword first, embeddings in Phase 2 |
| Pricing | Per-seat vs usage-based | Per-seat or per-site for hosting; usage-based for AI |
| Monorepo tool | Nx vs Turborepo | Nx |

## 9. Risks

| Risk | Why it matters | Response |
| --- | --- | --- |
| Crowded market | Mintlify, Nextra and Fumadocs are established | Make AI-in-core and self-hosting clearly better, not just present |
| Enterprise is a separate business | Hosting, support and billing have their own costs | Do it only after real self-hosted usage exists |
| AI answer quality | Bad citations damage trust quickly | Citation validation and an evaluation set in CI |
| Scope | The feature list is very large | Ship Phase 1 and 2 first; cut or defer the rest by demand |
| Too many packages | Release and maintenance overhead | Start with few packages and split later |
| LLM cost for self-hosters and cloud | Usage can spike | Rate limits, caching, token budgets |

## 10. Open questions

- [ ] License: Apache 2.0, or something that protects against resellers?
- [ ] Confirm that `dockudos` is available on npm, GitHub and as a domain, and that the `@dockudos` scope is free.
- [ ] Target date for the first open-source release.
- [ ] Solo build or a team, which decides how much of Phase 5 is realistic.
- [ ] Which LLM and embedding adapters ship first.
- [x] Whether any enterprise features should be paid-only. Decided: enterprise features (SAML SSO, audit logs, SLAs, support, managed cloud) are built in a separate private repo; nothing already open moves behind a paywall. See [enterprise/](./enterprise/README.md).
