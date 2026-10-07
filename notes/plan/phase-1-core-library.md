# Phase 1: Core library (MVP)

**Goal:** `npx dockudos init` gives a polished docs site in minutes, with zero config beyond the docs folder.

**Depends on:** Phase 0. **Done when** (development.md): a new project builds with zero config beyond the docs folder, and all components render in light and dark mode.

## Tasks

### 1A. Config and content pipeline (`core`, `next`)
- [ ] P1.1 Full `docs.json` schema: `name`, `logo`, `favicon`, `theme`, `navigation` (tabs, groups, pages, external links), `redirects`, `seo`. Export JSON Schema for editor autocomplete.
- [ ] P1.2 Content discovery: walk `docs/`, map file path to URL, read frontmatter (`title`, `description`, `icon`, `hidden`, etc.) and validate it.
- [ ] P1.3 MDX compile pipeline (remark/rehype): headings with stable ids, admonitions, links, images.
- [ ] P1.4 Page tree: combine config navigation with discovered pages; sidebar from config or from folder structure.
- [ ] P1.5 Headless helpers: breadcrumb, previous/next, TOC extraction, usable without React.
- [ ] P1.6 Redirects from config applied through `withDocs()`.
- [ ] P1.7 `include` directive to reuse content from other files (with cycle detection).
- [ ] P1.8 Last-modified time from Git, with a fallback when Git is unavailable.
- [ ] P1.9 SEO: titles, metadata, canonical URLs, sitemap, robots.
- [ ] P1.10 `withDocs()` finalised: wires pipeline, routes, metadata, sitemap; preserves user Next config.

### 1B. UI (`ui`)
- [ ] P1.11 Theme tokens as CSS variables (colors, fonts, radius, spacing); `theme.primary` from config generates a palette; custom CSS override hook.
- [ ] P1.12 Dark mode: light, dark, system, toggle, no flash on load.
- [ ] P1.13 Layouts: Docs (default), Notebook, Spacious, Flux, Glass, Home; selectable via `theme.layout`.
- [ ] P1.14 Navigation UI: navbar, tabs, sidebar (collapsible groups, active state), mobile drawer, TOC with scroll tracking, prev/next links.
- [ ] P1.15 Core components: Accordion, Tabs, Steps, Cards, Callouts (note, info, warning, danger), Code Groups, Tooltip.
- [ ] P1.16 Extra components: Banner, Files (file tree), GitHub Info, Zoomable Image, Inline TOC, Type Table, Auto Type Table, Graph View.
- [ ] P1.17 Code blocks: Shiki highlighting, copy button, line highlighting, titles, Twoslash hints.
- [ ] P1.18 Code conveniences: package-manager install tabs (npm, pnpm, yarn, bun), TS-to-JS tabs.
- [ ] P1.19 Mermaid diagrams and math equations (loaded lazily).
- [ ] P1.20 Image handling: automatic sizing and zoom.
- [ ] P1.21 Component override by name (extension point from architecture.md section 7).
- [ ] P1.22 Accessibility pass: semantic HTML, skip link, focus states, keyboard nav, alt-text checks.

### 1C. CLI (`cli`)
- [ ] P1.23 `dockudos init [name]`: prompts (site name, package manager, enable AI) and scaffolds from `templates/`.
- [ ] P1.24 `templates/default`: working starter (`docs/`, `docs.json`, `next.config.mjs`, `package.json`).
- [ ] P1.25 `dockudos dev`: dev server with live reload on MDX and `docs.json` changes.
- [ ] P1.26 `dockudos build`: production build; fails with clear messages on bad config.
- [ ] P1.27 `dockudos broken-links`: internal links and anchors, optional external links, non-zero exit on failure; also runs during build.
- [ ] P1.28 Existing-project path: `pnpm add @dockudos/*` + `withDocs()` documented and tested.

### 1D. Docs and release
- [ ] P1.29 `apps/docs`: dockudos's own docs built with dockudos (getting started, config reference, component reference, CLI).
- [ ] P1.30 Publish `0.x` to npm with provenance; changelog generated.
- [ ] P1.31 Add code of conduct and issue/PR templates for the first public release.

## Acceptance criteria

- [ ] `npx dockudos init my-docs && cd my-docs && pnpm install && pnpm dev` shows a styled site with sidebar, TOC and search-less navigation in under 5 minutes on a clean machine.
- [ ] `pnpm build` on the template succeeds with no config beyond `docs/` and a minimal `docs.json`.
- [ ] Every component and layout renders correctly in light and dark mode (visual check recorded for each).
- [ ] An invalid `docs.json` fails the build with a message naming the key and the problem.
- [ ] A broken internal link or anchor fails `broken-links` with the source file and line.
- [ ] Redirects, sitemap and canonical URLs are present in the production build output.
- [ ] Lighthouse performance 95+ and accessibility 95+ on the default theme (example site).
- [ ] The headless `core` imports no React and can drive a custom frontend (proven by a tiny non-React script test).
- [ ] Published packages install from npm into a fresh Next.js App Router project.

## Tests

### Unit (Vitest)
- [ ] Config schema: every key valid/invalid case; error messages name the key.
- [ ] Frontmatter parsing and validation, including missing title fallback.
- [ ] Path-to-URL mapping: index files, nested folders, special characters, `hidden` pages.
- [ ] Page tree: config-defined vs folder-derived sidebar; pages missing from navigation.
- [ ] Breadcrumb, prev/next and TOC helpers on a fixture tree.
- [ ] `include`: nested includes, missing file, cycle detected.
- [ ] Redirect resolution, including loops and conflicts.
- [ ] Last-modified: Git present, Git absent, uncommitted file.
- [ ] Link checker: valid, dead page, dead anchor, external timeout handling.

### Component (Testing Library)
- [ ] Each core and extra component renders, handles props, and is keyboard operable (Tabs, Accordion, Tooltip).
- [ ] Theme toggle persists and respects system preference.
- [ ] Code block: copy button, line highlight, title.
- [ ] Sidebar active state and mobile drawer.

### E2E (Playwright on `apps/example`)
- [ ] Navigate via sidebar, TOC and prev/next; URLs and scroll positions correct.
- [ ] Dark/light/system switching with no flash.
- [ ] Redirect from an old URL lands on the new one.
- [ ] `/sitemap.xml` and canonical tags correct.
- [ ] axe accessibility scan passes on representative pages in both modes.
- [ ] CLI: `init` into a temp dir, `install`, `build` succeeds (run in CI against the Verdaccio-published packages).

### Visual
- [ ] Screenshot baselines for each layout and each component in light and dark mode.
