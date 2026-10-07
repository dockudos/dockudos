# @dockudos/core

The headless core of [dockudos](https://github.com/dockudos/dockudos): the `docs.json` schema, page
tree, navigation, breadcrumbs, table of contents, redirects, includes, SEO helpers and the link
checker. It has no React and no Next.js, so it can drive any frontend or script.

```bash
npm install @dockudos/core
```

```ts
import {
  buildNavigation,
  buildPageTree,
  extractToc,
  parseConfig,
} from '@dockudos/core';
import { discoverPages, loadConfig } from '@dockudos/core/node'; // reads files

const config = parseConfig({ name: 'Acme' });
```

`@dockudos/core/docs.schema.json` is a JSON Schema for editor completion in `docs.json`.

Most people want the [`dockudos` CLI](https://www.npmjs.com/package/@dockudos/cli) instead.
See the documentation for the full API.
