# Phase 4: Content at scale

**Goal:** docs for multiple versions, languages and audiences.

**Depends on:** Phases 1-2 (page tree, index with locale/version/access filter hooks). Phase 3 optional. Order within the phase should follow what early users ask for; the tasks below are grouped, not strictly sequential.

**Done when** (development.md): one docs site serves two versions in two languages, with a changelog feed and a private section behind login.

## Tasks

### 4A. Versioning
- [x] P4.1 `versions` config (list, default); content layout convention (folder or branch snapshot) decided and documented. *`versions: { default, list[{ name, label, dir, status, navigation }] }`. Layout: `docs/<version>/<language>/…`; the default version has no URL prefix. Guide: `guides/versions`.*
- [x] P4.2 Routing with version prefix, version switcher UI, "latest" and "outdated version" banner. *Version switcher (same page, else nearest parent, else home), deprecated/unreleased/outdated notice, `/old` → latest equivalent. Default-spelled addresses redirect (`/en/…`, `/v2/…`).*
- [x] P4.3 Per-version page tree, sitemap and canonical URLs. *A page tree and sidebar per version and language; old-version pages are canonical to the latest equivalent; sitemap lists each page once with `xhtml:link` alternates.*
- [x] P4.4 Index, search, ask, navigate and MCP filter by version. *One `scopeFilter` for the palette, `/api/search`, the browser index, ask, navigate, `llms*.txt`, MCP, PDF, EPUB and feeds. Unknown scope is a 400 listing what exists.*

### 4B. Internationalization
- [x] P4.5 `i18n` config (locales, default); locale-prefixed routing and middleware; language switcher. *`i18n: { default, locales, detect, messages }`; locale-prefixed routes, proxy redirect from `Accept-Language` (cookie wins), language switcher.*
- [x] P4.6 Fallback to default locale for untranslated pages with a visible notice; `hreflang` tags. *An untranslated page is shown in the default language with a notice, canonical to the original, `noindex,follow`, out of the sitemap and the switcher. `hreflang` + `x-default`.*
- [x] P4.7 Translated UI strings and RTL support check. *Interface words in en, es, fr, de, pt, ja, zh, ar (written here; a native review is welcome) with per-site overrides; `lang`/`dir` on the frame, logical CSS, code kept LTR. Assistant panel strings stay English.*
- [x] P4.8 Index, search and AI filter by locale; answer in the reader's locale where the model supports it. *Retrieval filtered by locale; the model is told to answer in the reader's language.*

### 4C. Changelog, RSS, feedback
- [x] P4.9 Changelog component/page type with date-based entries and tags. *`<Changelog>` (tag filter) around `<Update>`; entries have ids; `changelog.path` names the page.*
- [x] P4.10 RSS feeds for changelog and docs/blog content. *`feeds.changelog` → `/changelog.xml`, `feeds.posts` → `/rss.xml` (pages with `date`), RSS 2.0, autodiscovery links, no protected/hidden/stand-in items.*
- [x] P4.11 Page feedback (thumbs up/down) with a hook to send to the user's backend; no personal data by default. *Votes already existed (kudos). Added `kudos.webhook` (secret from env, 3 s, no redirects, no personal data; `includeUser` adds the user id only).*

### 4D. Private docs and access control
- [x] P4.12 Auth abstraction (OAuth/OIDC provider adapter) using `DOCKUDOS_AUTH_SECRET`; session handling. *`auth` block: OIDC (discovery, PKCE, JWKS RS256/ES256, state, nonce), signed session cookie from `DOCKUDOS_AUTH_SECRET`, `/api/auth/{login,callback,logout,session}`.*
- [x] P4.13 Access rules in config (per page/group/role); pages render on demand for protected content. *`require: login` with `roles` / `groups`, deny by default; rules cover all versions/languages; protected pages rendered on request, not prebuilt; sidebar hides them from others.*
- [x] P4.14 Access filter applied **at retrieval time** so unseen chunks never reach search, the model, `llms.txt` or MCP; MCP requires a token for private docs. *`resolveViewer` runs the rules of the page route per request; `site.indexFor(viewer)` is the only index handed to search, ask, navigate and MCP; answer cache keyed by viewer. MCP uses `token` rules.*
- [x] P4.15 Protected content excluded from sitemap, RSS, OG images and static export. *Excluded from sitemap, feeds, OG cards, `llms*.txt`, the static export (which now leaves them out instead of refusing).*

### 4E. Export, images, layouts
- [x] P4.16 Static export: `dockudos build --static [--base-path /x]` writes plain files to `out/`; keyword search from a static index, `.md` twins, redirect pages; AI, feedback, MCP and the proxy are left out and their buttons hidden; fails on `access` rules. *Built with `apps/docs` (125 pages, `--base-path /demo`); tests in `cli.spec.ts` and `with-docs.spec.ts`. Served by a plain file server and searched in a browser: `e2e/static.spec.ts`.*
- [x] P4.17 OG image generation for every page. *`/og/<path>.png` drawn with `next/og` (rewrite to `/api/og`), brand color, contrast-aware text, `og:image`/`twitter:image`; `dockudos build --static` writes them to `out/og/`.*
- [x] P4.18 PDF and EPUB export of pages/sections. *`dockudos pdf --version --locale --path` (scoped `/print`) and `dockudos epub` (EPUB 3, no browser). A real PDF was printed with Chrome; the EPUB was read back with a zip and XML parser.*
- [x] P4.19 Custom page layouts for landing/marketing pages built from components. *`layout: landing` + `<Section>` bands.*
- [x] P4.20 Story component (live controls for UI components). *`<Story of=… controls=…>` with a component registry (`registerStoryComponents`).*

### 4F. Extra content sources
- [x] P4.21 `ContentSource` interface with the local MDX source refactored onto it. *`ContentSource { name, read() }`; the docs folder is `createLocalSource`, and discovery reads through it. `assertSourceFiles` is the contract.*
- [x] P4.22 Sources: remote MDX, Obsidian vault, local HTML, Notion, Sanity (order by demand). *`remote`, `obsidian`, `html`, `notion`, `sanity` sources and `dockudos sync` (manifest, no hand-written file touched). Notion and Sanity tested against mocked APIs only.*

### 4G. Docs
- [x] P4.23 Docs in `apps/docs` for versioning, i18n, access control, export and sources. *Guides: versions, languages, content sources, changelog and RSS, sign-in and roles; updates to protecting pages, static export, printing, SEO, layouts, kudos, CLI, docs.json and frontmatter references; components Changelog, Section, Story.*

## Acceptance criteria

- [x] One example site serves 2 versions x 2 locales; each combination routes, searches and answers within its own scope (no cross-version or cross-locale results). *`apps/scale`; browser tests in `e2e/versions-languages.spec.ts`, API/ask/navigate/MCP scope tests in `packages/next/src/content-at-scale.spec.ts`.*
- [x] The version switcher keeps the reader on the equivalent page when it exists, and falls back gracefully when it does not.
- [x] Changelog renders and its RSS feed validates. *Parsed by the browser's XML parser and checked against RSS 2.0's required elements; the W3C validator needs network, so it was not run.*
- [x] A private section requires login; an unauthenticated user cannot see it in pages, search results, ask answers, `llms.txt`, Markdown twins, sitemap or MCP (verified by tests for each surface). *`content-at-scale.spec.ts` ("crawls every public surface") and `e2e/private.spec.ts`.*
- [x] Static export builds and works for pages and keyword search without a server. *`e2e/static.spec.ts`, served by a plain file server.*
- [x] Every page has an OG image; PDF/EPUB export produces valid, readable files. *Real PNGs from `next/og`; a real PDF from Chrome (page counts and text checked with `pdftotext`); EPUB checked with a zip reader and XML parser (no `epubcheck` here).*
- [x] Feedback submissions reach the configured hook and respect the no-personal-data default. *`kudos-webhook.spec.ts` posts to a real local HTTP server.*

## Tests

### Unit
- [x] Version resolution and fallback rules; version-aware page tree. *`variants.spec.ts`, `node.spec.ts`.*
- [x] Locale negotiation, fallback and hreflang generation. *`variants.spec.ts`.*
- [x] Access rule evaluation (roles, groups, deny by default). *`access-layer.spec.ts`, `access.spec.ts` (`expandAccessRules`).*
- [x] Retrieval filter: chunks outside the user's version/locale/access are never returned (property-style test over a mixed corpus). *`access-layer.spec.ts` (filters), `content-at-scale.spec.ts` (mixed corpus through every surface).*
- [x] RSS and sitemap generation with versions, locales and private exclusions. *`feed.spec.ts`, `phase4-core.spec.ts`.*
- [x] `ContentSource` contract test suite run against each source implementation. *`sources/sources.spec.ts` ("ContentSource contract").*

### Integration / E2E
- [x] Switch version and language; URLs, content and search scope are correct. *`e2e/versions-languages.spec.ts`.*
- [x] Login flow with a mock OIDC provider; protected route redirects, then renders. *`auth.spec.ts` (in process), `e2e/private.spec.ts` (browser, `e2e/mock-idp.mjs`).*
- [x] Leak test: crawl all public surfaces unauthenticated and assert no private strings appear. *`content-at-scale.spec.ts`, `e2e/private.spec.ts`.*
- [x] Ask and navigate as two users with different roles return different allowed sources. *`content-at-scale.spec.ts`.*
- [x] Static export served by a plain file server; palette search works. *`e2e/static.spec.ts`.*
- [x] RSS validates against a feed validator; PDF/EPUB open with a parser. *RSS parsed in a browser (`e2e/changelog-feeds.spec.ts`); PDF and EPUB opened with `pdftotext`, a zip reader and an XML parser (see above). The W3C validator and `epubcheck` were not available offline.*
- [x] Feedback button posts to a local test endpoint. *`kudos-webhook.spec.ts`, `e2e/changelog-feeds.spec.ts`.*

### Non-functional
- [x] Build time and index size with 2 versions x 2 locales x 1,000 pages tracked. *`node tools/bench-scale.mjs` (4,000 pages: discovery 0.6 s, cold index 0.6 s, unchanged 0.3 s, whole index 8.7 MB, 2.2 MB for the one version and language a browser downloads, before gzip). `next build` of 4,000 pages was not timed.*
- [x] Security review of the auth and access layer (use the `security-and-hardening` checklist). *[notes/security/phase-4-auth-and-access.md](../security/phase-4-auth-and-access.md): six findings fixed, limits listed.*
