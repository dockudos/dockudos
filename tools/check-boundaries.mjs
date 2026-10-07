#!/usr/bin/env node
// Proves the module-boundary lint rule is live: plants a forbidden import
// (core -> next) and expects `nx lint` to fail with enforce-module-boundaries.
// See notes/adr/0005-package-layout.md.
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const fixture = 'packages/core/src/boundary-fixture.ts';
writeFileSync(
  fixture,
  "import { withDocs } from '@dockudos/next';\nexport const x = withDocs;\n",
);
try {
  const r = spawnSync(
    'pnpm',
    ['nx', 'lint', '@dockudos/core', '--skip-nx-cache'],
    { encoding: 'utf8' },
  );
  const out = r.stdout + r.stderr;
  if (r.status === 0 || !out.includes('@nx/enforce-module-boundaries')) {
    console.error(
      'FAIL: forbidden core -> next import was not rejected by lint',
    );
    console.error(out);
    process.exitCode = 1;
  } else {
    console.log('OK: module-boundary rule rejects core -> next');
  }
} finally {
  rmSync(fixture, { force: true });
}
