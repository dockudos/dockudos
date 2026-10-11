import type { AgentEvalCase } from './agent-eval.ts';

const DOCS = [
  {
    path: '/guides/webhooks',
    title: 'Webhooks',
    body: '# Webhooks\n\nSet `WEBHOOK_SECRET` to the secret you configured on the host.\n\nCall `verifySignature` on every delivery before you trust it.\n',
  },
  {
    path: '/guides/cli',
    title: 'Command line',
    body: '# Command line\n\nRun `dockudos build --static` for a plain-file site.\n\nUse `--base-path` to serve from a sub-folder.\n',
  },
  {
    path: '/guides/auth',
    title: 'Authentication',
    body: '# Authentication\n\nSet `AUTH_ISSUER` to your OpenID Connect provider and `AUTH_CLIENT_ID` to the client.\n',
  },
  {
    path: '/reference/api',
    title: 'API reference',
    body: '# API reference\n\n`GET /api/v1/builds` lists the builds of a site.\n\n`POST /api/v1/sites` connects a repository.\n',
  },
  {
    path: '/guides/install',
    title: 'Install',
    body: '# Install\n\nRun `npm install dockudos`. That is all.\n',
  },
  {
    path: '/guides/theming',
    title: 'Theming',
    body: '# Theming\n\nChange `primaryColor` in the theme section of docs.json.\n',
  },
];

/** Hand-written cases: a code change, the pages it touches, and what a good edit says. Add one for every miss seen in the field. */
export const AGENT_EVAL_SET: AgentEvalCase[] = [
  {
    id: 'env-var-renamed',
    pages: DOCS,
    expectedPages: ['/guides/webhooks'],
    change: [
      {
        path: 'src/hooks/verify.ts',
        status: 'modified',
        patch:
          '-const secret = process.env.WEBHOOK_SECRET;\n+const secret = process.env.HOOKS_SIGNING_KEY;',
      },
    ],
    edit: {
      mustContain: ['HOOKS_SIGNING_KEY'],
      mustNotContain: ['`WEBHOOK_SECRET`'],
    },
  },
  {
    id: 'function-renamed',
    pages: DOCS,
    expectedPages: ['/guides/webhooks'],
    change: [
      {
        path: 'src/hooks/verify.ts',
        status: 'modified',
        patch:
          '-export function verifySignature(body, sig) {}\n+export function verifyDelivery(body, sig) {}',
      },
    ],
    edit: {
      mustContain: ['verifyDelivery'],
      mustNotContain: ['verifySignature'],
    },
  },
  {
    id: 'flag-added',
    pages: DOCS,
    expectedPages: ['/guides/cli'],
    change: [
      {
        path: 'packages/cli/src/build.ts',
        status: 'modified',
        patch:
          '+  .option("--out-dir <dir>", "where to write the static site")',
      },
    ],
    edit: { mustContain: ['--out-dir'] },
  },
  {
    id: 'flag-removed',
    pages: DOCS,
    expectedPages: ['/guides/cli'],
    change: [
      {
        path: 'packages/cli/src/build.ts',
        status: 'modified',
        patch: '-  .option("--base-path <p>")',
      },
    ],
    edit: { mustContain: [], mustNotContain: [] },
  },
  {
    id: 'route-added',
    pages: DOCS,
    expectedPages: ['/reference/api'],
    change: [
      {
        path: 'src/routes/sites.ts',
        status: 'modified',
        patch: "+router.delete('/api/v1/sites', removeSite)",
      },
    ],
    edit: { mustContain: ['DELETE /api/v1/sites'] },
  },
  {
    id: 'two-pages',
    pages: DOCS,
    expectedPages: ['/guides/auth'],
    change: [
      {
        path: 'src/auth/oidc.ts',
        status: 'modified',
        patch:
          '-const issuer = process.env.AUTH_ISSUER;\n+const issuer = process.env.OIDC_ISSUER_URL;',
      },
    ],
    edit: { mustContain: ['OIDC_ISSUER_URL'] },
  },
  {
    id: 'option-renamed',
    pages: DOCS,
    expectedPages: ['/guides/theming'],
    change: [
      {
        path: 'packages/core/src/theme.ts',
        status: 'modified',
        patch: '-  primaryColor: z.string(),\n+  brandColor: z.string(),',
      },
    ],
    edit: { mustContain: ['brandColor'], mustNotContain: ['`primaryColor`'] },
  },
  {
    id: 'internal-refactor',
    pages: DOCS,
    expectedPages: [],
    change: [
      {
        path: 'src/internal/cache.ts',
        status: 'modified',
        patch: '+const hitRatio = 0;\n+export function evictOldest() {}',
      },
    ],
  },
  {
    id: 'tests-only',
    pages: DOCS,
    expectedPages: [],
    change: [
      {
        path: 'src/hooks/verify.spec.ts',
        status: 'modified',
        patch: '+process.env.WEBHOOK_SECRET = "x";',
      },
    ],
  },
  {
    id: 'lockfile-only',
    pages: DOCS,
    expectedPages: [],
    change: [
      {
        path: 'pnpm-lock.yaml',
        status: 'modified',
        patch: '+  AUTH_ISSUER: 1.0.0',
      },
    ],
  },
];
