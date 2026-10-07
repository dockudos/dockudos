# 0003: Next.js App Router only

## Context
Supporting both routers doubles the wrapper surface and test matrix.

## Decision
Target the App Router only.

## Consequences
- `withDocs()` and route helpers assume `app/`. Pages Router projects are out of scope (listed in features.md).
