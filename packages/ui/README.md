# @dockudos/ui

Shared shadcn/ui components (Radix, Tailwind v4) for dockudos apps.

## Add a component

Run from `apps/web` (or any app with a `components.json`); files land in `packages/ui/src/components`:

```bash
cd apps/web && pnpm dlx shadcn@latest add <component>
```

Then export it from `src/index.ts`. If the CLI writes a wrong import such as `from "cn"`, change it to `@dockudos/ui/lib/utils`.

## Use

```tsx
import '@dockudos/ui/globals.css'; // once, in the app root layout
import { Button } from '@dockudos/ui/components/button';
```

Apps need `@tailwindcss/postcss` in `postcss.config.mjs` and `transpilePackages: ['@dockudos/ui']` in `next.config.js`.
