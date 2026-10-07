# @dockudos/next

The Next.js integration for [dockudos](https://github.com/dockudos/dockudos).

- `withDocs(nextConfig, { root })` compiles `.mdx` through the dockudos pipeline, validates
  `docs.json`, and applies its redirects.
- `@dockudos/next/server`: `getSite()`, `pageMetadata()`, `siteMetadata()`, `siteCss()`, sitemap and robots handlers.
- `@dockudos/next/client`: `DocsRoot`, which connects the UI to Next's router.
- `@dockudos/next/mdx-components`: `defineMdxComponents()`, for `mdx-components.tsx`.

```bash
npm install @dockudos/core @dockudos/next @dockudos/ui
```

```js
// next.config.mjs
import { withDocs } from '@dockudos/next';

export default withDocs({}, { root: import.meta.dirname });
```

Peer dependencies: `next` 15 or newer, `react` 19. `typescript` is optional and enables
`ts-to-js`, Twoslash and `<AutoTypeTable>`.

Start a new site with `npx dockudos init`.
