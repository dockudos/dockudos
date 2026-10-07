# Phase 3: API docs

**Goal:** a spec becomes an interactive API reference.

**Depends on:** Phase 1 (UI, page tree) and Phase 2 (so generated pages are indexed for search and AI). **Done when** (development.md): a real-world OpenAPI spec renders every endpoint, and the playground can call a live test API.

Package: start inside `core`/`ui`; split into `@dockudos/openapi` when it needs to stand alone.

## Tasks

### 3A. OpenAPI
- [ ] P3.1 Spec loader: local file and hosted URL, JSON and YAML, OpenAPI 3.0 and 3.1; resolve `$ref` (including circular refs); clear build errors when a spec cannot be fetched or parsed.
- [ ] P3.2 Normalised internal model of operations, schemas, parameters, responses, security schemes.
- [ ] P3.3 Page generation: one page per endpoint with parameters, request body, responses, examples; schema rendering for `oneOf`/`anyOf`/`allOf`, enums, nullable, discriminators.
- [ ] P3.4 Navigation: group by tag, path or custom config; integrates with the sidebar and `navigation` in `docs.json`; `openapi.sources[].path` mounts it.
- [ ] P3.5 Config: `openapi.sources[]` (`name`, `spec`, `path`), `playground`, validated by the schema.
- [ ] P3.6 Index integration: endpoints become chunks (method, path, summary) so search, ask, navigation and MCP find them.

### 3B. Code samples
- [ ] P3.7 Generator for curl, JavaScript (fetch), Python (requests), Go, plus a plugin interface for more languages; uses spec examples and auth schemes.
- [ ] P3.8 Language tab selection persisted across pages.

### 3C. Playground
- [ ] P3.9 Request builder UI: path/query/header/body inputs generated from schema with validation.
- [ ] P3.10 Auth input for API key, bearer, basic, OAuth token; values stay in the browser.
- [ ] P3.11 Requests sent browser-to-API (no dockudos proxy by default); CORS failure message explains the fix; optional opt-in proxy documented with warnings.
- [ ] P3.12 Response viewer: status, headers, timing, formatted body.

### 3D. AsyncAPI and GraphQL
- [ ] P3.13 AsyncAPI 2.x/3.x: channels, messages, servers pages.
- [ ] P3.14 GraphQL from a schema (SDL or introspection): queries, mutations, subscriptions, types, enums, inputs.

### 3E. Docs from code
- [ ] P3.15 TypeScript definitions to reference pages (builds on Auto Type Table from Phase 1).
- [ ] P3.16 Python package docs from docstrings (decide approach: static parse vs. Sphinx/griffe output ingestion).

### 3F. Hardening and docs
- [ ] P3.17 Performance: large-spec handling (thousands of operations) with lazy loading and build caching.
- [ ] P3.18 Docs in `apps/docs` and a sample `openapi.json` in `apps/example`.

## Acceptance criteria

- [ ] A real-world spec (for example the public Stripe, GitHub or Petstore specs) renders **every** endpoint with no missing operations (operation count in = pages out).
- [ ] The playground successfully calls a live test API (for example Petstore or a local mock server) and shows the response.
- [ ] A spec that cannot be fetched fails the build with the URL and the reason.
- [ ] Circular and composed schemas render without infinite loops or crashes.
- [ ] Generated endpoints are searchable and answerable through the Phase 2 features.
- [ ] Secrets entered in the playground never leave the browser except to the target API (verified by a network test).
- [ ] A 2,000-operation spec builds within an agreed time budget (set in P3.17) and pages remain interactive.
- [ ] AsyncAPI and GraphQL fixtures render complete pages.

## Tests

### Unit
- [ ] Loader: local, remote (mocked), YAML, invalid, unreachable.
- [ ] `$ref` resolution including circular references and external refs.
- [ ] Model normaliser against 3.0 and 3.1 differences (nullable, `type` arrays, `exclusiveMinimum`).
- [ ] Schema-to-view: `oneOf/anyOf/allOf`, discriminator, additionalProperties, enums.
- [ ] Code sample generators: snapshot per language for body, query, headers and auth variants.
- [ ] Grouping and path mounting produce expected navigation.
- [ ] GraphQL and AsyncAPI model parsers on fixtures.

### Component
- [ ] Parameter table, response tabs, schema tree expand/collapse.
- [ ] Playground form validation from schema; error states.

### E2E
- [ ] Render a bundled real-world spec; count of rendered operations equals spec operations.
- [ ] Playground sends a request to a local mock server (Playwright route or Prism) and displays the response; secret not sent elsewhere.
- [ ] Code sample language switch persists.
- [ ] Search finds an endpoint by path and by summary.

### Non-functional
- [ ] Build-time benchmark on a large spec in CI.
- [ ] axe scan on an endpoint page in both color modes.
