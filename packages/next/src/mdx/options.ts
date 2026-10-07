import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type Plugin = string | [string, Record<string, unknown>];

export interface MdxPipelineOptions {
  /** Absolute path of the docs folder. */
  docsDir: string;
  /** Absolute path of the project's `public` folder. */
  publicDir: string;
}

const require = createRequire(import.meta.url);
// Running from source (tests) the siblings are `.ts`; from `dist` they are `.js`.
const ownExt = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const own = (name: string) =>
  fileURLToPath(new URL(`./${name}.${ownExt}`, import.meta.url));

/**
 * Plugins are given as absolute paths, not names: the MDX loader resolves
 * names from the page's folder, where a package manager with strict
 * `node_modules` cannot see our dependencies. Paths also keep the options
 * serializable, which Turbopack needs.
 */
export function mdxPipeline({ docsDir, publicDir }: MdxPipelineOptions): {
  remarkPlugins: Plugin[];
  rehypePlugins: Plugin[];
} {
  return {
    remarkPlugins: [
      require.resolve('remark-frontmatter'),
      require.resolve('remark-gfm'),
      require.resolve('remark-directive'),
      // `$5 and $10` is prose, not math, so inline math is written `$$x$$`.
      [require.resolve('remark-math'), { singleDollarTextMath: false }],
      [own('remark-include'), { docsDir }],
      own('remark-admonitions'),
      own('remark-code'),
      [own('remark-links'), { docsDir }],
      [own('remark-images'), { publicDir }],
      [own('remark-math-styles'), { css: '@dockudos/next/katex.css' }],
    ],
    rehypePlugins: [
      require.resolve('rehype-slug'),
      [require.resolve('rehype-autolink-headings'), { behavior: 'wrap' }],
      require.resolve('rehype-katex'),
      own('rehype-code'),
    ],
  };
}
