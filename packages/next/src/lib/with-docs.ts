import { resolveRedirects } from '@dockudos/core';
import { discoverPages, loadConfigSync } from '@dockudos/core/node';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { mdxPipeline } from '../mdx/options.ts';

const DOC_EXTENSIONS = ['md', 'mdx'];

/**
 * Where Markdown twins come from. `/guides/auth.md` and any request that asks for `text/markdown`
 * (`Accept: text/markdown`) are answered by the markdown route, which checks `access` rules for the page.
 * Requests for `/api/*`, `/_next/*` and files with an extension are never rewritten.
 */
const MARKDOWN_ROUTE = '/api/markdown';
const WANTS_MARKDOWN = [
  { type: 'header' as const, key: 'accept', value: '.*text/markdown.*' },
];
export const markdownRewrites = () => [
  {
    source: '/:path(.+)\\.md',
    destination: MARKDOWN_ROUTE,
  },
  {
    source: '/',
    has: WANTS_MARKDOWN,
    destination: MARKDOWN_ROUTE,
  },
  {
    source: '/:path((?!api/|_next/)[^.]*)',
    has: WANTS_MARKDOWN,
    destination: MARKDOWN_ROUTE,
  },
];

/**
 * `dockudos build --static` sets `DOCKUDOS_STATIC=1` (and `DOCKUDOS_BASE_PATH` for hosts that serve from a
 * sub-path, such as GitHub Pages project sites). The site is then written to `out/` as plain files.
 * Export supports no `rewrites`, `headers` or `redirects`, so those are left out here.
 */
const isStatic = () => process.env.DOCKUDOS_STATIC === '1';
const basePath = () =>
  (process.env.DOCKUDOS_BASE_PATH ?? '')
    .replace(/\/+$/, '')
    .replace(/^(?!\/|$)/, '/');

export interface WithDocsOptions {
  /** Project root, where `docs.json` lives. Default `process.cwd()`. */
  root?: string;
  /** Folder with the MDX files, relative to `root`. Default `docs`. */
  docsDir?: string;
}

/**
 * Wrap a Next.js config for a dockudos site:
 * - validates `docs.json` now, so a bad config fails `next dev` and `next build` with the key named;
 * - compiles `.md` and `.mdx` files through the dockudos MDX pipeline;
 * - applies `redirects` from `docs.json` after the user's own.
 *
 * The user's config is preserved; `pageExtensions` is extended, never replaced.
 */
export function withDocs(
  nextConfig: NextConfig = {},
  { root = process.cwd(), docsDir = 'docs' }: WithDocsOptions = {},
): NextConfig {
  const config = loadConfigSync(root);
  const absoluteDocsDir = resolve(root, docsDir);
  const pageExtensions = nextConfig.pageExtensions ?? [
    'js',
    'jsx',
    'ts',
    'tsx',
  ];

  const withMdx = createMDX({
    extension: /\.mdx?$/,
    options: mdxPipeline({
      docsDir: absoluteDocsDir,
      publicDir: resolve(root, 'public'),
      prefix: config.urlPrefix,
    }),
  });

  if (isStatic()) {
    const base = basePath();
    return withMdx({
      ...nextConfig,
      output: 'export',
      trailingSlash: true,
      images: { ...nextConfig.images, unoptimized: true },
      ...(base && { basePath: base }),
      env: {
        ...nextConfig.env,
        NEXT_PUBLIC_DOCKUDOS_STATIC: '1',
        NEXT_PUBLIC_DOCKUDOS_BASE_PATH: base,
      },
      pageExtensions: [
        ...pageExtensions,
        ...DOC_EXTENSIONS.filter((ext) => !pageExtensions.includes(ext)),
      ],
    });
  }

  return withMdx({
    ...nextConfig,
    // The rules (not the secrets) go into the build, so `src/proxy.ts` needs no file access.
    env: {
      ...nextConfig.env,
      DOCKUDOS_ACCESS: JSON.stringify(config.access.rules),
    },
    pageExtensions: [
      ...pageExtensions,
      ...DOC_EXTENSIONS.filter((ext) => !pageExtensions.includes(ext)),
    ],
    async rewrites() {
      const own = await nextConfig.rewrites?.();
      const mine = markdownRewrites();
      if (!own) return { beforeFiles: mine, afterFiles: [], fallback: [] };
      if (Array.isArray(own))
        return { beforeFiles: mine, afterFiles: own, fallback: [] };
      return { ...own, beforeFiles: [...mine, ...(own.beforeFiles ?? [])] };
    },
    // Only your own site and the origins in `ai.allowedOrigins` may show the embeddable assistant in a frame.
    async headers() {
      const own = (await nextConfig.headers?.()) ?? [];
      const ancestors = ["'self'", ...config.ai.allowedOrigins].join(' ');
      return [
        ...own,
        {
          source: '/embed',
          headers: [
            {
              key: 'Content-Security-Policy',
              value: `frame-ancestors ${ancestors}`,
            },
          ],
        },
      ];
    },
    async redirects() {
      const own = (await nextConfig.redirects?.()) ?? [];
      if (config.redirects.length === 0) return own;
      const pages = await discoverPages(absoluteDocsDir, {
        prefix: config.urlPrefix,
      });
      return [
        ...own,
        ...resolveRedirects(
          config.redirects,
          pages.pages.map((p) => p.path),
        ),
      ];
    },
  });
}
