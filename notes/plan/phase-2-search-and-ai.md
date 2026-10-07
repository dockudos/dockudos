# Phase 2: Search and AI

**Goal:** visitors can find or ask for anything, and AI tools can read the docs. This is the headline differentiator.

**Depends on:** Phase 1 (MDX pipeline, page tree, UI shell). **Done when** (development.md): a question about any documented topic returns an answer with working citations, and the palette navigates to the right heading for a natural-language request.

Design reference: [ai.md](../ai.md), [architecture.md](../architecture.md) sections 4 and 5.

## Tasks

### 2A. Content index
- [x] P2.1 Types: `ContentIndex`, `PageRecord`, `ChunkRecord` in `core`.
- [x] P2.2 Extractor: title, description, headings, plain text, anchors per page.
- [x] P2.3 Chunker: split at heading boundaries with a size cap; stable chunk ids (hash of path + heading path + text).
- [x] P2.4 Index writer: emit JSON next to build output as part of `dockudos build`.
- [x] P2.5 Incremental rebuild: reuse unchanged pages and chunks from a cache.

### 2B. Keyword search
- [x] P2.6 Keyword engine (BM25-style) with heading/title boost; runs in the browser from the index.
- [x] P2.7 Search client abstraction and `SearchBackend` interface.
- [x] P2.8 Command palette (Cmd+K / Ctrl+K): results with title, heading path, snippet; keyboard navigation; a11y.
- [x] P2.9 Page content endpoint `/api/page` returning full text by path.
- [x] P2.10 `search` config key with the `builtin`, `server` and `custom` (endpoint, or a `SearchBackend` in code) backends.
- [ ] P2.10b Hosted adapters: Algolia, Meilisearch, Typesense, Orama Cloud, FlexSearch. Deliberately deferred: add in order of demand; the `SearchBackend` interface is the extension point.

### 2C. Machine-readable outputs
- [x] P2.11 `llms.txt` and `llms-full.txt` generated at build.
- [x] P2.12 Markdown twins: `.md` suffix and `Accept: text/markdown` content negotiation.
- [x] P2.13 Respect `hidden` pages and (later) access rules in all outputs.

### 2D. Provider layer
- [x] P2.14 `LLMProvider` and `EmbeddingProvider` interfaces plus a mock provider for tests.
- [x] P2.15 First adapters (decided in P0.4); env var names finalised (`DOCKUDOS_LLM_API_KEY`, etc.); custom adapter docs.
- [x] P2.16 `ai` config block (provider, model, embeddings, limits) validated by the schema; secrets never read from `docs.json`.

### 2E. Retrieval and answers
- [x] P2.17 Hybrid retrieval: keyword + vector via reciprocal rank fusion; filters for locale/version/access are no-op hooks now.
- [x] P2.18 Embeddings at build time, cached by content hash; vector storage in the index file.
- [x] P2.19 `/api/ask`: retrieve, build prompt with labeled chunks within token budget, stream `token`, `sources`, `done`, `error` events.
- [x] P2.20 Citation validation: ids must belong to the retrieved set, invalid ids dropped, uncited answers retried or flagged.
- [x] P2.21 Refusals: decline when nothing relevant is retrieved or when out of scope; suggest related pages.
- [x] P2.22 Prompt-injection hardening: retrieved text delimited and labeled untrusted; no tools exposed to the assistant.
- [x] P2.23 Safeguards: per-IP rate limit, max question length, max output tokens, caching of repeated questions.
- [x] P2.24 Assistant UI in the palette and as a panel: streaming render, numbered source links, history.

### 2F. AI navigation
- [x] P2.25 `/api/navigate` returning `{ path, anchor, reason, alternatives? }`; model-ranked when an LLM is set, top chunk otherwise.
- [x] P2.26 Palette behavior: jump and scroll to anchor with a one-line reason; show alternatives when confidence is low.
- [x] P2.27 Decide palette UX: separate mode or default for natural-language queries (ai.md open question).

### 2G. MCP and embeddable assistant
- [ ] P2.28 MCP server with `search_docs`, `get_page`, `list_pages`; route handler `/mcp` and standalone process.
- [ ] P2.29 Embeddable widget (script + React component) and documented `/api/ask` usage with API key; context hints.

### 2H. Evaluation and docs
- [ ] P2.30 Evaluation set on `apps/example`: questions, expected pages, unanswerable questions, navigation targets.
- [ ] P2.31 Eval runner with metrics (hit rate, citation validity, refusal accuracy, navigation accuracy) wired into CI against a mock/recorded provider.
- [ ] P2.32 Docs in `apps/docs`: search, AI setup, `llms.txt`, MCP, widget, privacy and cost notes.

## Acceptance criteria

- [ ] With **no** LLM key: keyword search, palette, `llms.txt`, Markdown twins and MCP search/get tools all work.
- [ ] With a key: asking about any documented topic streams an answer whose every citation resolves to a real page and anchor.
- [x] An out-of-scope or unanswerable question is declined and suggests related pages.
- [ ] A natural-language navigation request jumps to the correct page and heading for every case in the eval set.
- [ ] Citation validity is 100% on the eval set; retrieval hit rate, refusal accuracy and navigation accuracy are recorded and tracked per commit.
- [ ] Palette search latency under 100 ms on a 1,000-page generated corpus (done: `search-benchmark.spec.ts`); first AI token under 2 s with the reference provider.
- [x] No API key appears in client bundles, `docs.json` or build output (verified by a bundle scan).
- [ ] An MCP-capable coding tool connects and retrieves a page from the example site.
- [x] Rate limits and size caps return clear errors, not crashes.

## Tests

### Unit
- [x] Chunker: size cap, heading path, anchors, stable ids, content change alters only affected chunks.
- [x] Extractor on fixtures with code blocks, tables, MDX components.
- [x] Keyword engine: exact API names, error codes, typos, ranking with heading boost.
- [x] RRF fusion with known rankings; keyword-only fallback.
- [x] Embedding cache: hit, miss, invalidation by content hash.
- [x] Citation validator: valid, invalid, missing ids.
- [x] Rate limiter and token-budget packer.
- [x] `llms.txt` / `llms-full.txt` output format and hidden-page exclusion.

### Retrieval and AI (fixed corpus, mock provider)
- [ ] Retrieval hit rate over the eval question set (top-5 contains expected page).
- [x] Answer stream contract: event order, sources mapped to URLs with anchors.
- [x] Refusal cases and prompt-injection fixtures (docs containing "ignore previous instructions") do not change behavior.
- [ ] Navigation accuracy over labeled targets, with and without an LLM.

### Integration / E2E (Playwright)
- [x] Cmd+K opens the palette; typing returns results; Enter navigates.
- [x] Ask flow with mocked LLM: streamed text, clickable numbered sources.
- [x] AI navigation lands on the heading and shows the reason.
- [x] `curl -H "Accept: text/markdown"` returns the Markdown twin.
- [ ] MCP client smoke test: list tools, call `search_docs` and `get_page`.
- [ ] Widget embedded in a plain HTML page can ask a question.

### Non-functional
- [x] Benchmark: search latency on 1,000 pages tracked in CI.
- [ ] Bundle scan: assert no secrets and a size budget for the palette chunk.
- [ ] Optional live-provider eval job (manual or nightly), not blocking PRs.
