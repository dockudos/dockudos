# 0007: `apps/web` is the marketing site

## Context
`apps/web` was scaffolded with Tailwind and `@dockudos/ui` (shadcn-style). It is not the docs site and not the end-to-end fixture.

## Decision
- `apps/web`: public marketing/landing site for dockudos.
- `apps/example`: minimal fixture site for end-to-end tests. Kept deliberately small.
- `apps/docs`: dockudos's own docs built with dockudos, created in Phase 1.

## Consequences
- No rename needed. `apps/web` must not be depended on by packages.
