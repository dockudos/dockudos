import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const DOC_EXTENSIONS = ['md', 'mdx'];

/**
 * Wrap a Next.js config so `.md` and `.mdx` files compile to React components.
 * The user's own config fields are preserved; `pageExtensions` is extended, never replaced.
 */
export function withDocs(nextConfig: NextConfig = {}): NextConfig {
  const pageExtensions = nextConfig.pageExtensions ?? [
    'js',
    'jsx',
    'ts',
    'tsx',
  ];
  const withMdx = createMDX({ extension: /\.mdx?$/ });
  return withMdx({
    ...nextConfig,
    pageExtensions: [
      ...pageExtensions,
      ...DOC_EXTENSIONS.filter((ext) => !pageExtensions.includes(ext)),
    ],
  });
}
