# 0009. API pages are generated MDX, Python docs come from Griffe

Status: accepted

## Context

Phase 3 turns specs and code into reference pages. Pages need to be indexed (search, assistant, `llms.txt`, MCP), appear in the
navigation, and work for specs with thousands of operations. Python docs need a decision: parse Python ourselves (static parse),
or read the output of an existing tool (Sphinx, Griffe).

## Decision

1. **Generate real MDX files** (`dockudos generate`) instead of virtual pages rendered at request time. A generated page is an
   ordinary page: discovery, navigation, links check, search index, Markdown twins and the MCP server need no special case, and
   the bundler compiles it like any other. Each endpoint page embeds its operation as JSON next to a few lines of MDX; schemas
   it refers to are separate files in `public/` that the browser loads when a field is opened. A manifest of written files lets
   the command remove pages that left the spec without touching anyone else's files.
2. **Spec text never goes into MDX raw.** It is escaped, or passed as JSON props, or placed in code fences. A hostile
   description cannot break the build (a test compiles pages from one).
3. **Python: ingest `griffe dump` JSON.** Griffe already resolves annotations, inheritance and `__all__`; the JSON is stable and
   shared with other tools. A static parser in JavaScript would be less accurate and need to follow the Python grammar. Sphinx
   output is not read. Docstrings are shown as text; their sections are not parsed.
4. **TypeScript: the compiler API**, loaded on demand (`typescript` is an optional peer), the same way `<AutoTypeTable>` does.
5. **The playground sends requests from the browser.** The proxy is opt-in, limited to the spec's hosts and an allow list.

## Consequences

- A build needs `dockudos generate` before `next build` when it does not go through the CLI (Nx: a `generate` target).
- Generated files live in `docs/<path>/`, `.dockudos/api/` and `public/_dockudos/api/`: committing or ignoring them is the
  project's choice. Schema files are public even when pages are protected, so private APIs are out of scope until Phase 4.
- Changing the output format means bumping `GENERATOR_VERSION` so cached results are not reused.
- Operation counts are checked against the spec (pages in = operations in), with the real Petstore in the end-to-end tests.
