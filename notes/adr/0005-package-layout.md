# 0005: Few packages, enforced boundaries

## Context
More packages mean more release overhead. But dependency direction (headless core, replaceable UI) must not erode.

## Decision
Start with `core`, `ui`, `next`, `cli`. `search`, `mcp` and `openapi` live inside `core` or `ai` until they need to stand alone. Enforce direction with Nx tags and `@nx/enforce-module-boundaries`:

| Tag | May depend on |
| --- | --- |
| `scope:core` | nothing internal |
| `scope:ui` | `scope:core` |
| `scope:next` | `scope:core`, `scope:ui` |
| `scope:cli` | `scope:core`, `scope:next` |
| `scope:app` | any package |

## Consequences
- A forbidden import fails `lint`; a fixture test proves the rule is live.
- New packages must declare a scope tag.
