# Features

Every feature planned for dockudos, grouped by area. The **Phase** column matches the build plan in [development.md](./development.md). All features are open source and self-hostable unless marked **Cloud**.

> **Status:** planned. Nothing here is built yet.

## 1. Authoring

| Feature | Description | Phase |
| --- | --- | --- |
| MDX pages | Markdown plus React components, with frontmatter (`title`, `description`, `icon`, etc.) | 1 |
| Core components | Accordion, Tabs, Steps, Cards, Callouts (note, info, warning, danger), Code Groups, Tooltips | 1 |
| Extra components | Banner, Files (file tree), GitHub Info, Zoomable Image, Inline TOC, Type Table, Auto Type Table, Graph View of all pages | 1 |
| Diagrams and math | Mermaid diagrams, math equations | 1 |
| Code blocks | Shiki highlighting, copy button, line highlighting, titles, TypeScript Twoslash hints | 1 |
| Code conveniences | Package-manager install tabs (npm, pnpm, yarn, bun), TypeScript-to-JavaScript tabs | 1 |
| Include | Reuse content from other files with an include directive | 1 |
| Last modified | Show the last edit time of a page, taken from Git | 1 |
| Image handling | Automatic image sizing and zoom | 1 |

## 2. Site structure and navigation

| Feature | Description | Phase |
| --- | --- | --- |
| Config file | `docs.json` for navigation, tabs, groups, logo, navbar, colors, and settings, validated by a schema | 1 |
| Sidebar | Generated from config or from the folder structure | 1 |
| Table of contents | Per-page heading outline with scroll tracking | 1 |
| Previous / next | Links between neighboring pages | 1 |
| Redirects | Declared in config | 1 |
| Layouts | Docs (default), Notebook (compact), Spacious, Flux (minimal), Glass (translucent), Home | 1 |
| Custom page layouts | Landing and marketing pages built from components | 4 |
| Headless core | Page tree, TOC, breadcrumb and search logic without UI, so teams can build their own frontend | 1 |

## 3. Theming and accessibility

| Feature | Description | Phase |
| --- | --- | --- |
| Dark mode | Light, dark and system, with a toggle | 1 |
| Theme tokens | Colors, fonts, radius and spacing as CSS variables | 1 |
| Custom CSS | Override styles without forking | 1 |
| Accessibility | Semantic HTML, keyboard navigation, focus states, alt-text checks, WCAG-minded defaults | 1 |

## 4. Search

| Feature | Description | Phase |
| --- | --- | --- |
| Command palette | Cmd+K / Ctrl+K search overlay | 2 |
| Keyword search | Built-in, runs from a build-time index, no external service | 2 |
| Semantic search | Embedding-based retrieval, combined with keyword search | 2 |
| Pluggable backends | Built-in, Algolia, Meilisearch, Typesense, Orama Cloud, FlexSearch, or a custom adapter | 2 |
| Page content endpoint | Returns a page's full text by path, for use after a search | 2 |

## 5. AI features

| Feature | Description | Phase |
| --- | --- | --- |
| **AI querying** | "Ask the docs" assistant that retrieves relevant sections and answers with cited links back to source pages | 2 |
| **AI navigation** | Describe what you need in plain language and jump to the right page and heading | 2 |
| `llms.txt` / `llms-full.txt` | Generated automatically so AI tools can discover and read the docs | 2 |
| Content negotiation | Serve Markdown instead of HTML to AI agents that ask for it | 2 |
| MCP server | Exposes docs search and page content as tools for AI coding assistants | 2 |
| Pluggable LLM provider | Bring your own key; adapters for common providers and a custom adapter interface | 2 |
| Embeddable assistant | A widget or API to put the assistant inside your own app | 2 |
| AI agent (platform) | Opens pull requests that update docs when code or content changes; scheduled automations | 5 |
| Managed AI (**Cloud**) | Hosted assistant, embeddings and vector store, so no keys or infrastructure to run | 5 |

Details of how these work are in [ai.md](./ai.md).

## 6. API documentation

| Feature | Description | Phase |
| --- | --- | --- |
| OpenAPI | Generate reference pages from a spec, with flexible navigation and endpoint grouping | 3 |
| AsyncAPI | Generate pages for event-driven APIs | 3 |
| GraphQL | Generate pages from a schema | 3 |
| Playground | Send real requests from the docs | 3 |
| Code samples | Auto-generated in multiple languages | 3 |
| Spec sources | Local files or hosted URLs, with clear build errors when a spec cannot be fetched | 3 |
| Generated from code | Docs from TypeScript definitions and Python packages | 3 |

## 7. Content at scale

| Feature | Description | Phase |
| --- | --- | --- |
| Versioning | Multiple versions with a version switcher | 4 |
| Internationalization | Locale-based routing and a language switcher | 4 |
| Changelog | Date-based entries with an RSS feed | 4 |
| Page feedback | Thumbs up/down with hooks to send data to your own backend | 4 |
| Private docs | OAuth login, plus access control to limit which content each user sees | 4 |
| Static export | Self-contained static output, for hosting anywhere (AI features need a server or external endpoint) | 4 |
| OG images | Generated social preview image for every page | 4 |
| Export | PDF and EPUB export of docs pages | 4 |
| RSS | Feeds for docs and blog content | 4 |
| Extra content sources | Notion, Obsidian vault, Sanity, remote MDX, local HTML | 4 |
| Story component | Display UI components with live controls | 4 |
| Link checking | Build-time broken-link detection, also available as a CLI command | 1 |
| SEO | Page titles, metadata, sitemap, canonical URLs | 1 |

## 8. CLI

| Command | Purpose | Phase |
| --- | --- | --- |
| `dockudos init` | Scaffold a new docs site | 1 |
| `dockudos dev` | Local dev server with live reload | 1 |
| `dockudos build` | Production build and content index | 1 |
| `dockudos broken-links` | Check internal and external links | 1 |

## 9. Platform services (open source, self-hostable)

These ship in the open-source repository as Docker services. See [self-hosting-and-cloud.md](./self-hosting-and-cloud.md).

| Service | Description | Phase |
| --- | --- | --- |
| Web editor | Edit Markdown and MDX visually with live preview, with files in Git as the source of truth | 5 |
| Analytics | Page views, search queries, feedback and assistant conversations | 5 |
| Auth and teams | SSO, teams, roles, private docs | 5 |
| AI agent | Opens pull requests that keep docs up to date; scheduled automations | 5 |
| Git webhook | GitHub and GitLab webhook that rebuilds on every push | 5 |
| Deployment kit | Docker Compose and Helm chart for one-command deployment | 5 |

## 10. Managed cloud (paid)

The cloud runs the platform for you. It adds operations, not exclusive features.

| Capability | Description |
| --- | --- |
| One-click hosting | Connect a repository and get a live site |
| Custom domains, SSL, CDN | Managed for you |
| Preview deployments | A preview URL per branch |
| Updates and backups | Automatic |
| Scaling and uptime | Monitored and managed |
| Managed AI | No LLM keys or vector store to run |
| Support | Help from the team |

## Features deliberately out of scope for the library

- A closed-source editor or analytics product. If it ships, it is open source and self-hostable.
- Support for the Pages Router. dockudos targets the App Router only.
- Vendor lock-in to one LLM provider. The provider layer is pluggable.
