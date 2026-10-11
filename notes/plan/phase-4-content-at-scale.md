# Phase 4: Content at scale

**Goal:** docs for multiple versions, languages and audiences.

**Depends on:** Phases 1-2 (page tree, index with locale/version/access filter hooks). Phase 3 optional. Order within the phase should follow what early users ask for; the tasks below are grouped, not strictly sequential.

**Done when** (development.md): one docs site serves two versions in two languages, with a changelog feed and a private section behind login.

## Tasks

### 4A. Versioning
- [ ] P4.1 `versions` config (list, default); content layout convention (folder or branch snapshot) decided and documented.
- [ ] P4.2 Routing with version prefix, version switcher UI, "latest" and "outdated version" banner.
- [ ] P4.3 Per-version page tree, sitemap and canonical URLs.
- [ ] P4.4 Index, search, ask, navigate and MCP filter by version.

### 4B. Internationalization
- [ ] P4.5 `i18n` config (locales, default); locale-prefixed routing and middleware; language switcher.
- [ ] P4.6 Fallback to default locale for untranslated pages with a visible notice; `hreflang` tags.
- [ ] P4.7 Translated UI strings and RTL support check.
- [ ] P4.8 Index, search and AI filter by locale; answer in the reader's locale where the model supports it.

### 4C. Changelog, RSS, feedback
- [ ] P4.9 Changelog component/page type with date-based entries and tags.
- [ ] P4.10 RSS feeds for changelog and docs/blog content.
- [ ] P4.11 Page feedback (thumbs up/down) with a hook to send to the user's backend; no personal data by default.

### 4D. Private docs and access control
- [ ] P4.12 Auth abstraction (OAuth/OIDC provider adapter) using `DOCKUDOS_AUTH_SECRET`; session handling.
- [ ] P4.13 Access rules in config (per page/group/role); pages render on demand for protected content.
- [ ] P4.14 Access filter applied **at retrieval time** so unseen chunks never reach search, the model, `llms.txt` or MCP; MCP requires a token for private docs.
- [ ] P4.15 Protected content excluded from sitemap, RSS, OG images and static export.

### 4E. Export, images, layouts
- [x] P4.16 Static export: `dockudos build --static [--base-path /x]` writes plain files to `out/`; keyword search from a static index, `.md` twins, redirect pages; AI, feedback, MCP and the proxy are left out and their buttons hidden; fails on `access` rules. *Built with `apps/docs` (125 pages, `--base-path /demo`); tests in `cli.spec.ts` and `with-docs.spec.ts`. Not yet run in a browser.*
- [ ] P4.17 OG image generation for every page.
- [ ] P4.18 PDF and EPUB export of pages/sections.
- [ ] P4.19 Custom page layouts for landing/marketing pages built from components.
- [ ] P4.20 Story component (live controls for UI components).

### 4F. Extra content sources
- [ ] P4.21 `ContentSource` interface with the local MDX source refactored onto it.
- [ ] P4.22 Sources: remote MDX, Obsidian vault, local HTML, Notion, Sanity (order by demand).

### 4G. Docs
- [ ] P4.23 Docs in `apps/docs` for versioning, i18n, access control, export and sources.

## Acceptance criteria

- [ ] One example site serves 2 versions x 2 locales; each combination routes, searches and answers within its own scope (no cross-version or cross-locale results).
- [ ] The version switcher keeps the reader on the equivalent page when it exists, and falls back gracefully when it does not.
- [ ] Changelog renders and its RSS feed validates.
- [ ] A private section requires login; an unauthenticated user cannot see it in pages, search results, ask answers, `llms.txt`, Markdown twins, sitemap or MCP (verified by tests for each surface).
- [ ] Static export builds and works for pages and keyword search without a server. *Builds; the browser check is the test below.*
- [ ] Every page has an OG image; PDF/EPUB export produces valid, readable files.
- [ ] Feedback submissions reach the configured hook and respect the no-personal-data default.

## Tests

### Unit
- [ ] Version resolution and fallback rules; version-aware page tree.
- [ ] Locale negotiation, fallback and hreflang generation.
- [ ] Access rule evaluation (roles, groups, deny by default).
- [ ] Retrieval filter: chunks outside the user's version/locale/access are never returned (property-style test over a mixed corpus).
- [ ] RSS and sitemap generation with versions, locales and private exclusions.
- [ ] `ContentSource` contract test suite run against each source implementation.

### Integration / E2E
- [ ] Switch version and language; URLs, content and search scope are correct.
- [ ] Login flow with a mock OIDC provider; protected route redirects, then renders.
- [ ] Leak test: crawl all public surfaces unauthenticated and assert no private strings appear.
- [ ] Ask and navigate as two users with different roles return different allowed sources.
- [ ] Static export served by a plain file server; palette search works.
- [ ] RSS validates against a feed validator; PDF/EPUB open with a parser.
- [ ] Feedback button posts to a local test endpoint.

### Non-functional
- [ ] Build time and index size with 2 versions x 2 locales x 1,000 pages tracked.
- [ ] Security review of the auth and access layer (use the `security-and-hardening` checklist).
