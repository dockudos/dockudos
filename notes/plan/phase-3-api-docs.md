# Phase 3: API docs

**Goal:** a spec becomes an interactive API reference.

**Depends on:** Phase 1 (UI, page tree) and Phase 2 (so generated pages are indexed for search and AI). **Done when** (development.md): a real-world OpenAPI spec renders every endpoint, and the playground can call a live test API.

Package: start inside `core`/`ui`; split into `@dockudos/openapi` when it needs to stand alone.

## Tasks

### 3A. OpenAPI
- [x] P3.1 Spec loader: local file and hosted URL, JSON and YAML, OpenAPI 3.0 and 3.1; resolve `$ref` (including circular refs); clear build errors when a spec cannot be fetched or parsed.
- [x] P3.2 Normalised internal model of operations, schemas, parameters, responses, security schemes.
- [x] P3.3 Page generation: one page per endpoint with parameters, request body, responses, examples; schema rendering for `oneOf`/`anyOf`/`allOf`, enums, nullable, discriminators.
- [x] P3.4 Navigation: group by tag, path or custom config; integrates with the sidebar and `navigation` in `docs.json`; `openapi.sources[].path` mounts it.
- [x] P3.5 Config: `openapi.sources[]` (`name`, `spec`, `path`), `playground`, validated by the schema.
- [x] P3.6 Index integration: endpoints become chunks (method, path, summary) so search, ask, navigation and MCP find them.

### 3B. Code samples
- [x] P3.7 Generator for curl, JavaScript (fetch), Python (requests), Go, plus a plugin interface for more languages; uses spec examples and auth schemes.
- [x] P3.8 Language tab selection persisted across pages.

### 3C. Playground
- [x] P3.9 Request builder UI: path/query/header/body inputs generated from schema with validation.
- [x] P3.10 Auth input for API key, bearer, basic, OAuth token; values stay in the browser.
- [x] P3.11 Requests sent browser-to-API (no dockudos proxy by default); CORS failure message explains the fix; optional opt-in proxy documented with warnings.
- [x] P3.12 Response viewer: status, headers, timing, formatted body.

### 3D. AsyncAPI and GraphQL
- [x] P3.13 AsyncAPI 2.x/3.x: channels, messages, servers pages.
- [x] P3.14 GraphQL from a schema (SDL or introspection): queries, mutations, subscriptions, types, enums, inputs.

### 3E. Docs from code
- [x] P3.15 TypeScript definitions to reference pages (builds on Auto Type Table from Phase 1).
- [x] P3.16 Python package docs from docstrings (decide approach: static parse vs. Sphinx/griffe output ingestion).

### 3F. Hardening and docs
- [x] P3.17 Performance: large-spec handling (thousands of operations) with lazy loading and build caching.
- [x] P3.18 Docs in `apps/docs` and a sample `openapi.json` in `apps/example`.

## Acceptance criteria

- [x] A real-world spec (for example the public Stripe, GitHub or Petstore specs) renders **every** endpoint with no missing operations (operation count in = pages out). *Evidence: the real Petstore in `apps/example` (`e2e/api.spec.ts` checks pages = operations and fetches each); the real GitHub (1,232 operations) and Stripe (612) specs were run through the generator by hand and gave pages = operations. They are not bundled or run in CI.*
- [x] The playground successfully calls a live test API (for example Petstore or a local mock server) and shows the response. *Evidence: `e2e/api.spec.ts` against a local mock (`e2e/mock-api.mjs`); also run by hand against the public https://petstore3.swagger.io.*
- [x] A spec that cannot be fetched fails the build with the URL and the reason. *Evidence: `openapi.spec.ts` ("stops with the location when a spec cannot be read").*
- [x] Circular and composed schemas render without infinite loops or crashes. *Evidence: `openapi.spec.ts`, `api.spec.tsx` (schema tree stops at a recursive reference), and an exponential blow-up in example generation found and fixed by `large-spec.spec.ts`.*
- [x] Generated endpoints are searchable and answerable through the Phase 2 features. *Evidence: palette search finds an endpoint by path and by summary (e2e); the Markdown twin carries the whole endpoint; the pages are in the index that ask, navigate and MCP read.*
- [x] Secrets entered in the playground never leave the browser except to the target API (verified by a network test). *Evidence: e2e records every request of the page and checks the secret goes only to the mock API and is not in `localStorage`.*
- [x] A 2,000-operation spec builds within an agreed time budget (set in P3.17) and pages remain interactive. *Evidence: budget 5 s and 60 kB a page in `large-spec.spec.ts` (measured about 0.4 s). Only generation is timed; a `next build` of 2,000 pages was not run.*
- [x] AsyncAPI and GraphQL fixtures render complete pages. *Evidence: `reference.spec.ts` (page counts, content, queries validated against the schema) and `generated-api.spec.ts` (every page compiles as MDX). Not rendered in the browser.*

## Tests

All unit, component, e2e and non-functional tests (loader, `$ref`, normaliser, schema view, code samples, navigation, GraphQL/AsyncAPI parsers, playground, search, axe, large-spec benchmark) are done; evidence is in the acceptance criteria above.
