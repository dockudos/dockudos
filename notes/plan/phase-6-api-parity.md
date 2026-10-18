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
- [x] P6.6 Storage layer: IndexedDB for collections, requests, environments and history; `sessionStorage` stays for credentials unless the reader opts in to remember them. Versioned schema with migrations; works with storage blocked (falls back to memory with a notice). *`packages/ui/src/components/api/client-db.ts` (database `dockudos-api-client`, version 1, stores `collections`, `requests`, `environments`, `history`, `examples`); every record carries its schema version and is read back by `migrate*` in `packages/core/src/lib/api/client.ts`, which leaves a record from a newer version alone. Writes are queued and a refusal (`QuotaExceededError`) becomes a notice. A record saved while the store was still opening survives the load (`merge` in `client-store.ts`).*
- [x] P6.7 Save a request from any endpoint page into a collection; open it again with its inputs filled in. Collections can be renamed, reordered and deleted. *Save and Saved requests under the playground's address bar open the client with the request in it; a saved request keeps its `origin` (operation, page, base URL and the form values). The tree is a real ARIA tree: arrow keys, Home, End, left and right to close and open.*
- [x] P6.8 Environments and variables: `{{baseUrl}}`, `{{token}}` in the URL, headers, params and body, with a picker. Secret variables are masked and never exported by default. *`client-variables.ts` (nesting, loops, missing names, `\{{escaped}}`); the picker is in `client-env.ts`, a small module endpoint pages can load without the rest of the client. A secret stays as `{{name}}` in the code samples and is filled in only in what is sent.*
- [x] P6.9 History of sent requests (method, URL, status, time), limited in size, clearable, off for requests that used a secret variable unless the reader opts in. *100 entries; the URL is kept as written, variables unresolved, and a playground send is recorded with `YOUR_TOKEN` placeholders rather than the credential.*
- [x] P6.10 A standalone client page (`/api-client`) that is not tied to one endpoint: free-form URL, method, headers, body, for calling anything. *`<ApiClient />` in any MDX file; `apps/example/docs/api-client.mdx` mounts it at `/api-client`.*
- [x] P6.11 Import and export: Postman collection v2.1, Bruno, cURL command, and a dockudos JSON file. Import never executes anything and ignores scripts. *`client-transfer.ts`, against real fixtures (`fixtures/postman-petstore.json`, `fixtures/bruno-petstore.json`, `fixtures/find-pet.bru`). Scripts, authentication and file-backed bodies are named in `warnings` and left out; a file may bring 100 collections of 500 requests.*
- [x] P6.12 Share a request as a link or file with secrets removed. *`#request=` in the fragment, which no browser sends to a server; a link over about 8,000 characters is refused with a note to export a file.*
- [x] P6.13 Response tools: save an example response, diff two responses, copy as cURL or code. *`client-response.ts`: ten kept responses per request, 100,000 characters each, and a longest-common-subsequence line diff that refuses a comparison over 4,000 lines. Copy as cURL, JavaScript, Python or Go, from the same generators the endpoint pages use.*
- [x] P6.14 Accessibility and keyboard use: axe checks, full keyboard flow, focus management in the collection tree. *axe on the client page in both colour schemes and a keyboard-only walk in `apps/example/e2e/api-client.spec.ts`; the panel takes focus on its heading when it opens.*
- [x] P6.15 Lazy load: the client is a separate chunk loaded on endpoint pages only; a bundle budget is added to `bundle.spec.ts`. *`client-lazy.tsx`; the budget asserts the chunk is under 40 KB gzipped and that no page — guide, endpoint or the client page itself — asks for it up front.*
- [x] P6.16 Docs: guide "API client", privacy statement of what is stored where. *`apps/docs/docs/guides/api-client.mdx`, with "What is stored, and where" and the limits; linked from the playground guide.*

### Not in this phase (decide later, on demand)
- Request scripts, pre-request and test scripts, collection runners. These need a sandbox and a security review.
- Cloud-synced collections (belongs to the managed cloud, see `../enterprise/`).

## Acceptance criteria

- [x] A spec with `x-codeSamples` shows those samples on the endpoint page, in the declared order, in all three modes.
- [x] A reader saves a request, reloads the page, finds it, and sends it with an environment variable substituted. *`apps/example/e2e/api-client.spec.ts`.*
- [~] Exporting a collection and importing it into Postman or Bruno works, and importing a Postman collection with scripts runs none. *The second half is tested (scripts are listed as warnings and never run). The first half is tested against the documented v2.1 and Bruno shapes and round-tripped through this project's own reader; **not run** against the Postman or Bruno applications themselves.*
- [x] No secret variable appears in an export, a shared link, the history, `localStorage`, or any request to the docs server (tests inspect each). *Unit tests per rule, and the browser test reads `indexedDB` and both storages after a run. Credentials typed into the playground stay where they always were: `sessionStorage` of the tab.*
- [x] The client works with IndexedDB unavailable. *`client-db.spec.ts`, `client-store.spec.tsx` and `client.spec.tsx` (the notice the reader sees).*

## Tests

- [x] Unit: `x-codeSamples` parsing and validation, alias mapping, replace/append rules.
- [x] Unit: variable substitution (nested, missing, escaped), import and export converters with real Postman and Bruno fixtures. *`client-variables.spec.ts`, `client-transfer.spec.ts`.*
- [x] Storage: migration from an older schema version; quota exceeded; blocked storage. *`client-db.spec.ts`, `client-edges.spec.tsx` (a read that fails halfway, a transaction given up on, a database another tab holds open, unreadable settings).*
- [x] Browser (Playwright): save, reload, replay; environment switch; import file; secret never stored (read `indexedDB` and `localStorage` after a run). *Plus axe in both colour schemes and a keyboard-only walk of the tree.*
- [x] Bundle budget for the client chunk. *`apps/example/e2e/bundle.spec.ts`: under 40 KB gzipped, and no page loads it up front.*

## Found while building this

- The variable editor used to write the whole list back on every keystroke, so two quick edits to one row could undo each other. A lost `secret` flag would then have put the value in the `localStorage` mirror. The store now changes one variable at a time (`updateVariable`, `addVariable`, `removeVariable`).
- A request saved while the store was still opening was overwritten when the read finished. `loadClient` now merges, keeping what the reader just did.
- A shared link that only changes the fragment of the page the reader is already on does not reload it, so the client listens for `hashchange` as well as reading the fragment on mount.
- `packages/ui/scripts/build-css.mjs` passed URL pathnames to postcss, which on Windows made the resolver look for `B:\B:\…` and failed every build and e2e run on this machine. It passes real paths now.

## Risks

- **Scope creep toward Postman.** Each item above is small; the list is closed. Anything else needs a new task here.
- **Secrets in browser storage.** The default is session-only; remembering is opt-in and says what it does.
