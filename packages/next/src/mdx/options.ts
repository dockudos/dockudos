import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type Plugin = string | [string, Record<string, unknown>];

export interface MdxPipelineOptions {
  /** Absolute path of the docs folder. */
  docsDir: string;
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
export function mdxPipeline({ docsDir }: MdxPipelineOptions): {
  remarkPlugins: Plugin[];
  rehypePlugins: Plugin[];
} {
  return {
    remarkPlugins: [
      require.resolve('remark-frontmatter'),
      require.resolve('remark-gfm'),
      require.resolve('remark-directive'),
      [own('remark-include'), { docsDir }],
      own('remark-admonitions'),
      [own('remark-links'), { docsDir }],
    ],
    rehypePlugins: [
      require.resolve('rehype-slug'),
      [require.resolve('rehype-autolink-headings'), { behavior: 'wrap' }],
    ],
  };
}
