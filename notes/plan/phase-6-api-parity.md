# Phase 6: API docs parity

**Goal:** close the two API-docs gaps found when comparing with other docs platforms: spec-supplied code samples (`x-codeSamples`) and a full API client in the playground.

**Depends on:** Phase 3 (generator, `samples.ts`, playground). **Done when:** a spec's own samples appear on its endpoint pages, and a reader can save, organise and replay requests across sessions without leaving the docs.

Where things live today: `packages/core/src/lib/api/samples.ts` (generated cURL, fetch, Python, Go), `packages/core/src/lib/api/request.ts` (request building), the playground UI in `packages/ui`. Credentials stay in `sessionStorage`; requests go browser to API.

## Tasks

### 6A. `x-codeSamples`
- [x] P6.1 Read `x-codeSamples` (and the older `x-code-samples`) from each operation in the normalised model: `lang`, `label`, `source`. Validate shape; a malformed entry is a build warning naming the operation, never a failure. *`readCodeSamples` in `packages/core/src/lib/api/code-samples.ts`; limits: 100,000 characters per sample, 20 per operation; `dockudos generate` prints `source: warning: GET /pets: x-codeSamples[0] has no "source"; ignored.`*
- [x] P6.2 Show them as tabs next to the generated samples. A sample with the same language replaces the generated one by default; `openapi.samples.mode` (`replace` | `append` | `generated-only`) controls it.
- [x] P6.3 Highlight by `lang` using the existing code-block pipeline; unknown languages render as plain text. Redocly's `x-codeSamples` also allows `lang` values such as `Shell`: map the common aliases (`Shell`, `cURL`, `Node.js`, `JavaScript`).
- [x] P6.4 Index the sample text so search and ask can find it (same chunking as generated samples).
- [x] P6.5 Docs in `apps/docs` (guide `api-reference`, config reference) and a spec with `x-codeSamples` in `apps/example`.

### 6B. API client (saved requests)
Scope decision, resolved here: **a client inside the docs page, state kept in the reader's browser.** No accounts, no server storage, no scripting. That keeps the playground's promise that secrets never reach the docs server.
- [ ] P6.6 Storage layer: IndexedDB for collections, requests, environments and history; `sessionStorage` stays for credentials unless the reader opts in to remember them. Versioned schema with migrations; works with storage blocked (falls back to memory with a notice).
- [ ] P6.7 Save a request from any endpoint page into a collection; open it again with its inputs filled in. Collections can be renamed, reordered and deleted.
- [ ] P6.8 Environments and variables: `{{baseUrl}}`, `{{token}}` in the URL, headers, params and body, with a picker. Secret variables are masked and never exported by default.
- [ ] P6.9 History of sent requests (method, URL, status, time), limited in size, clearable, off for requests that used a secret variable unless the reader opts in.
- [ ] P6.10 A standalone client page (`/api-client`) that is not tied to one endpoint: free-form URL, method, headers, body, for calling anything.
- [ ] P6.11 Import and export: Postman collection v2.1, Bruno, cURL command, and a dockudos JSON file. Import never executes anything and ignores scripts.
- [ ] P6.12 Share a request as a link or file with secrets removed.
- [ ] P6.13 Response tools: save an example response, diff two responses, copy as cURL or code.
- [ ] P6.14 Accessibility and keyboard use: axe checks, full keyboard flow, focus management in the collection tree.
- [ ] P6.15 Lazy load: the client is a separate chunk loaded on endpoint pages only; a bundle budget is added to `bundle.spec.ts`.
- [ ] P6.16 Docs: guide "API client", privacy statement of what is stored where.

### Not in this phase (decide later, on demand)
- Request scripts, pre-request and test scripts, collection runners. These need a sandbox and a security review.
- Cloud-synced collections (belongs to the managed cloud, see `../enterprise/`).

## Acceptance criteria

- [ ] A spec with `x-codeSamples` shows those samples on the endpoint page, in the declared order, in all three modes.
- [ ] A reader saves a request, reloads the page, finds it, and sends it with an environment variable substituted.
- [ ] Exporting a collection and importing it into Postman or Bruno works, and importing a Postman collection with scripts runs none.
- [ ] No secret variable appears in an export, a shared link, the history, `localStorage`, or any request to the docs server (tests inspect each).
- [ ] The client works with IndexedDB unavailable.

## Tests

- [ ] Unit: `x-codeSamples` parsing and validation, alias mapping, replace/append rules.
- [ ] Unit: variable substitution (nested, missing, escaped), import and export converters with real Postman and Bruno fixtures.
- [ ] Storage: migration from an older schema version; quota exceeded; blocked storage.
- [ ] Browser (Playwright): save, reload, replay; environment switch; import file; secret never stored (read `indexedDB` and `localStorage` after a run).
- [ ] Bundle budget for the client chunk.

## Risks

- **Scope creep toward Postman.** Each item above is small; the list is closed. Anything else needs a new task here.
- **Secrets in browser storage.** The default is session-only; remembering is opt-in and says what it does.
