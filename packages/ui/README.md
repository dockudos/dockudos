# @dockudos/ui

Layouts, theme and components for [dockudos](https://github.com/dockudos/dockudos) sites: callouts,
tabs, accordions, steps, cards, code blocks with copy buttons, file trees, type tables, diagrams,
a zoomable image, a page graph, and six page layouts in light and dark mode.

```bash
npm install @dockudos/ui
```

```tsx
import '@dockudos/ui/styles.css'; // compiled, no Tailwind setup needed
import { DocsLayout, ThemeScript } from '@dockudos/ui';
```

Colors, fonts and radius are CSS variables, so `docs.json` (or your own stylesheet) can change them.
Peer dependencies: `react` and `react-dom` 19.

Most people want the [`dockudos` CLI](https://www.npmjs.com/package/@dockudos/cli) instead.
