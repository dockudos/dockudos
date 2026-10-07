# Phase 1: Core library (MVP)

**Goal:** `npx dockudos init` gives a polished docs site in minutes, with zero config beyond the docs folder.

**Depends on:** Phase 0. **Done when** (development.md): a new project builds with zero config beyond the docs folder, and all components render in light and dark mode.

## Tasks

### 1A. Config and content pipeline (`core`, `next`)
- [x] P1.1 Full `docs.json` schema: `name`, `logo`, `favicon`, `theme`, `navigation` (tabs, groups, pages, external links), `redirects`, `seo`. Export JSON Schema for editor autocomplete.
- [x] P1.2 Content discovery: walk `docs/`, map file path to URL, read frontmatter (`title`, `description`, `icon`, `hidden`, etc.) and validate it.
- [x] P1.3 MDX compile pipeline (remark/rehype): headings with stable ids, admonitions, links, images.
- [x] P1.4 Page tree: combine config navigation with discovered pages; sidebar from config or from folder structure.
- [x] P1.5 Headless helpers: breadcrumb, previous/next, TOC extraction, usable without React.
- [x] P1.6 Redirects from config applied through `withDocs()`.
- [x] P1.7 `include` directive to reuse content from other files (with cycle detection).
- [x] P1.8 Last-modified time from Git, with a fallback when Git is unavailable.
- [x] P1.9 SEO: titles, metadata, canonical URLs, sitemap, robots.
- [x] P1.10 `withDocs()` finalised: wires pipeline, routes, metadata, sitemap; preserves user Next config.

### 1B. UI (`ui`)
- [x] P1.11 Theme tokens as CSS variables (colors, fonts, radius, spacing); `theme.primary` from config generates a palette; custom CSS override hook.
- [x] P1.12 Dark mode: light, dark, system, toggle, no flash on load.
- [x] P1.13 Layouts: Docs (default), Notebook, Spacious, Flux, Glass, Home; selectable via `theme.layout`.
- [x] P1.14 Navigation UI: navbar, tabs, sidebar (collapsible groups, active state), mobile drawer, TOC with scroll tracking, prev/next links.
- [x] P1.15 Core components: Accordion, Tabs, Steps, Cards, Callouts (note, info, warning, danger), Code Groups, Tooltip.
- [x] P1.16 Extra components: Banner, Files (file tree), GitHub Info, Zoomable Image, Inline TOC, Type Table, Auto Type Table, Graph View.
- [x] P1.17 Code blocks: Shiki highlighting, copy button, line highlighting, titles, Twoslash hints.
- [x] P1.18 Code conveniences: package-manager install tabs (npm, pnpm, yarn, bun), TS-to-JS tabs.
- [x] P1.19 Mermaid diagrams and math equations (loaded lazily).
- [x] P1.20 Image handling: automatic sizing and zoom.
- [x] P1.21 Component override by name (extension point from architecture.md section 7).
- [x] P1.22 Accessibility pass: semantic HTML, skip link, focus states, keyboard nav, alt-text checks.

### 1C. CLI (`cli`)
- [x] P1.23 `dockudos init [name]`: prompts (site name, package manager, enable AI) and scaffolds from `templates/`. *The "enable AI" prompt is left out until Phase 2 gives it something to enable; adding a `docs.json` key now would break the strict schema. Flags: `--name`, `--package-manager`, `--yes`.*
- [x] P1.24 `templates/default`: working starter (`docs/`, `docs.json`, `next.config.mjs`, `package.json`).
- [x] P1.25 `dockudos dev`: dev server with live reload on MDX and `docs.json` changes.
- [x] P1.26 `dockudos build`: production build; fails with clear messages on bad config.
- [x] P1.27 `dockudos broken-links`: internal links and anchors, optional external links, non-zero exit on failure; also runs during build.
- [x] P1.28 Existing-project path: `pnpm add @dockudos/*` + `withDocs()` documented and tested.

### 1D. Docs and release
- [x] P1.29 `apps/docs`: dockudos's own docs built with dockudos (getting started, config reference, component reference, CLI).
- [x] P1.30a Release pipeline ready: `nx release --dry-run` completes and builds the changelog; the Release workflow publishes with provenance; the four packages carry description, keywords, `engines` and READMEs. Verified by publishing to a local Verdaccio (`pnpm verify:packages`, `pnpm verify:init`; CI job `packages`).
- [ ] P1.30b **Owner action:** publish `0.x` to npm. Needs the `@dockudos` npm org and an `NPM_TOKEN` secret (P0.2b), a real GitHub repository (the `repository`, `homepage` and `bugs` URLs in each `package.json` assume `github.com/dockudos/dockudos`; provenance fails if they do not match), then run the Release workflow with `dry_run` off.
- [x] P1.31 Add code of conduct and issue/PR templates for the first public release.

## Acceptance criteria

- [x] `npx dockudos init my-docs && cd my-docs && pnpm install && pnpm dev` shows a styled site with sidebar, TOC and search-less navigation in under 5 minutes on a clean machine.
- [x] `pnpm build` on the template succeeds with no config beyond `docs/` and a minimal `docs.json`.
- [x] Every component and layout renders correctly in light and dark mode (visual check recorded for each).
- [x] An invalid `docs.json` fails the build with a message naming the key and the problem.
- [x] A broken internal link or anchor fails `broken-links` with the source file and line.
- [x] Redirects, sitemap and canonical URLs are present in the production build output.
- [x] Lighthouse performance 95+ and accessibility 95+ on the default theme (example site).
- [x] The headless `core` imports no React and can drive a custom frontend (proven by a tiny non-React script test).
- [ ] Published packages install from npm into a fresh Next.js App Router project. *Proven against a local Verdaccio registry (`pnpm verify:init`: `npx @dockudos/cli init`, install, build in about 30 s). Waits on P1.30b for the real registry.*

## Tests

### Unit (Vitest)
- [x] Config schema: every key valid/invalid case; error messages name the key.
- [x] Frontmatter parsing and validation, including missing title fallback.
- [x] Path-to-URL mapping: index files, nested folders, special characters, `hidden` pages.
- [x] Page tree: config-defined vs folder-derived sidebar; pages missing from navigation.
- [x] Breadcrumb, prev/next and TOC helpers on a fixture tree.
- [x] `include`: nested includes, missing file, cycle detected.
- [x] Redirect resolution, including loops and conflicts.
- [x] Last-modified: Git present, Git absent, uncommitted file.
- [x] Link checker: valid, dead page, dead anchor, external timeout handling.

### Component (Testing Library)
- [x] Each core and extra component renders, handles props, and is keyboard operable (Tabs, Accordion, Tooltip).
- [x] Theme toggle persists and respects system preference.
- [x] Code block: copy button, line highlight, title.
- [x] Sidebar active state and mobile drawer.

### E2E (Playwright on `apps/example`)
- [x] Navigate via sidebar, TOC and prev/next; URLs and scroll positions correct.
- [x] Dark/light/system switching with no flash.
- [x] Redirect from an old URL lands on the new one.
- [x] `/sitemap.xml` and canonical tags correct.
- [x] axe accessibility scan passes on representative pages in both modes.
- [x] CLI: `init` into a temp dir, `install`, `build` succeeds (run in CI against the Verdaccio-published packages).

### Visual
- [x] Screenshot baselines for each layout and each component in light and dark mode.

## Status notes

Evidence for the ticked boxes, so a reviewer does not have to go looking.

- **Acceptance, 5 minute start:** `pnpm verify:init` creates a site with `npx @dockudos/cli init`, installs from the registry, builds it, and checks the output: about 30 s including install.
- **Acceptance, light and dark:** `apps/example/e2e/visual.spec.ts` keeps 16 baselines: the six layouts and the components and code pages, each in light and dark. Every component appears on those two pages. `e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on 11 pages in both modes.
- **Acceptance, Lighthouse:** run against the production build of `apps/example` (mobile emulation, default throttling): performance 100, accessibility 100, best practices 100; SEO 92 to 100 (92 on a page without a description). LCP 1.8 s, TBT 30 ms, CLS 0.
- **Acceptance, headless core:** `packages/core/src/headless.spec.ts` imports the core with `react`, `react-dom` and `next` mocked to throw, drives a text-only frontend with it, and checks that nothing exported from `index.ts` uses `node:` APIs.
- **Visual baselines** are Linux-only (fonts), so they run in their own Playwright project (`pnpm nx e2e-visual @dockudos/example`) and not in the default CI job.
- **Decisions made along the way**, for the record:
  - `docs.json` gained `urlPrefix` so docs can be mounted at `/docs` in an app that has other routes.
  - Inline math is `$$x$$`, not `$x$`, so prose like "$5 and $10" is not turned into an equation.
  - Files and folders starting with `_` are not pages; they hold includes.
  - The brand color is nudged only as far as needed to reach 4.5:1 contrast, so the palette is accessible by construction.
  - MDX plugins are passed to `@next/mdx` as absolute paths with JSON-serializable options, because Turbopack requires both and strict `node_modules` hides our dependencies from the page's folder.
  - The page title comes from frontmatter and the layout renders the single `h1`; bodies should not repeat it.
- **Known limits:** editing an `<include>`d file does not hot-reload the including page in `dev`; `icon` in frontmatter is parsed but not displayed; `<GithubInfo>` needs network at build time (it degrades to a plain link).
- **Not yet run on GitHub:** the repository has no remote (see P0.11), so neither the main CI job nor the new `packages` job has executed there. Everything in this phase was verified locally on Node 24.
- **Magenta bars** in the visual baselines are Playwright's mask over the "Last updated" date, not a styling bug.
