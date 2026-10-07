# @dockudos/cli

The `dockudos` command.

```bash
npx @dockudos/cli init my-docs   # create a site
cd my-docs && npm install && npm run dev
```

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `dockudos init [dir]`   | Create a docs site from the default template.                   |
| `dockudos dev`          | Dev server; restarts when `docs.json` changes.                  |
| `dockudos build`        | Validate config and links, then `next build`.                   |
| `dockudos broken-links` | Check internal links and anchors (`--external` for http links). |

See the [dockudos](https://github.com/dockudos/dockudos) documentation. Requires Node.js 20.19 or newer.
