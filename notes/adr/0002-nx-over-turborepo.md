# 0002: Nx as the monorepo tool

## Context
Need generators, a project graph, affected-only CI and release tooling for a multi-package TypeScript repo. Turborepo is the lighter alternative.

## Decision
Use Nx with pnpm workspaces. Packages remain plain pnpm workspace packages (`workspace:*`), so leaving Nx is cheap.

## Consequences
- CI runs `nx affected`; releases use `nx release`.
- Targets are inferred by plugins (`@nx/js/typescript`, `@nx/eslint`, `@nx/vitest`, `@nx/next`); we avoid hand-written `project.json` unless needed.
- If Nx proves heavy, revisit; no package should import Nx APIs at runtime.
