<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg" />
    <img src=".github/assets/logo-light.svg" alt="dockudos" height="48" />
  </picture>
</p>

An AI-native documentation platform you can fully self-host. dockudos turns a folder of MDX files into a documentation site built on Next.js, with search, cited AI answers, AI navigation, `llms.txt` and an MCP server as core features.

> **Status: Phases 1 (core library) and 2 (search and AI) are implemented; the first npm release is pending.** `npx dockudos init` creates a styled docs site with full-text search, an optional cited-answer assistant, AI navigation, `llms.txt`, Markdown twins, an MCP server and an embeddable widget. API reference pages are planned for a later phase. The design lives in [`notes/`](./notes) and the build plan in [`notes/plan/`](./notes/plan).

## Repository layout

| Path            | What it is                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/core` | Headless: config schema, page tree, navigation, link checking. `@dockudos/core`, Node helpers in `/node` |
| `packages/next` | `withDocs()`, MDX pipeline, site data and metadata. `@dockudos/next`                                     |
| `packages/ui`   | Layouts, theme and components. `@dockudos/ui`                                                            |
| `packages/cli`  | The `dockudos` CLI: `init`, `dev`, `build`, `broken-links`. `@dockudos/cli`                              |
| `apps/docs`     | dockudos's own documentation, built with dockudos                                                        |
| `apps/example`  | Fixture site for end-to-end, accessibility and visual tests                                              |
| `apps/web`      | Marketing site ([ADR 0007](./notes/adr/0007-apps-web-is-marketing-site.md))                              |
| `notes/`        | Design docs, [ADRs](./notes/adr) and the [build plan](./notes/plan)                                      |
| `tools/`        | Repo guard scripts (module boundaries, published-package check)                                          |

Dependency direction is enforced by lint: `core` ← `ui` ← `next`, and `cli` → `core`, `next` ([ADR 0005](./notes/adr/0005-package-layout.md)).

## Getting started

Requires Node 20.19+ and pnpm (see `packageManager` in `package.json`).

```sh
pnpm install
pnpm nx dev @dockudos/docs         # http://localhost:3000, the dockudos documentation
pnpm nx dev @dockudos/example      # the fixture site used by the tests
```

## Everyday commands

Always run tasks through Nx.

```sh
pnpm nx run-many -t lint typecheck test build   # everything
pnpm nx affected -t lint typecheck test build e2e
pnpm nx e2e @dockudos/example                   # Playwright against the production build (includes axe checks)
pnpm nx e2e-visual @dockudos/example            # screenshot baselines; Linux fonts, run locally or in the Playwright image
pnpm schema                                     # regenerate packages/core/docs.schema.json after changing the config schema
pnpm nx graph                                   # project graph
pnpm format                                     # Prettier
pnpm check:boundaries                           # proves the module-boundary lint rule is live
```

First time running e2e: `pnpm exec playwright install chromium`.

## Releasing

Versions, changelog and tags come from [Conventional Commits](https://www.conventionalcommits.org) via `nx release`; packages are versioned together.

```sh
pnpm nx release --dry-run          # preview version bump and changelog
```

The [Release workflow](.github/workflows/release.yml) publishes to npm with provenance and defaults to a dry run.

### Testing published packages locally

```sh
pnpm nx local-registry                                  # Verdaccio on :4873 (rewrites your npm registry while running, restores on exit)
pnpm nx run-many -t build -p @dockudos/core @dockudos/next @dockudos/cli @dockudos/ui
pnpm nx release publish --registry http://localhost:4873/
pnpm verify:packages                                    # installs into a scratch project, typechecks and imports
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). License: [Apache 2.0](./LICENSE).
