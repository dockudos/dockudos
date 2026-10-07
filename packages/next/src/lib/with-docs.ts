import { resolveRedirects } from '@dockudos/core';
import { discoverPages, loadConfigSync } from '@dockudos/core/node';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { mdxPipeline } from '../mdx/options.ts';

const DOC_EXTENSIONS = ['md', 'mdx'];

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
    options: mdxPipeline({ docsDir: absoluteDocsDir }),
  });

  return withMdx({
    ...nextConfig,
    pageExtensions: [
      ...pageExtensions,
      ...DOC_EXTENSIONS.filter((ext) => !pageExtensions.includes(ext)),
    ],
    async redirects() {
      const own = (await nextConfig.redirects?.()) ?? [];
      if (config.redirects.length === 0) return own;
      const pages = await discoverPages(absoluteDocsDir);
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
