import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified, type Plugin } from 'unified';

export interface RemarkIncludeOptions {
  docsDir: string;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkMdx);

/**
 * Replace `<include>./path.mdx</include>` with the parsed content of that
 * file, recursively. Mirrors `expandIncludes` in core, but works on the
 * syntax tree so it can run inside the MDX compiler.
 */
const remarkInclude: Plugin<[RemarkIncludeOptions], Root> =
  ({ docsDir }) =>
  async (tree, file) => {
    if (!file.path) return;
    const self = relative(docsDir, file.path).replaceAll('\\', '/');
    await expand(tree.children, self, [self], docsDir);
  };

async function expand(
  children: RootContent[],
  file: string,
  stack: string[],
  docsDir: string,
): Promise<void> {
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as RootContent;
    if (isInclude(node)) {
      const target = resolve(file, toString(node).trim());
      const where = node.position
        ? `${file}:${node.position.start.line}`
        : file;
      if (stack.includes(target)) {
        throw new Error(
          `${where}: include cycle: ${[...stack, target].join(' -> ')}`,
        );
      }
      let text: string;
      try {
        text = await readFile(join(docsDir, target), 'utf8');
      } catch {
        throw new Error(`${where}: included file not found: ${target}`);
      }
      const inner = parser
        .parse(text)
        .children.filter((n) => n.type !== 'yaml');
      await expand(inner, target, [...stack, target], docsDir);
      children.splice(i, 1, ...inner);
      i += inner.length - 1;
    } else if ('children' in node && Array.isArray(node.children)) {
      await expand(node.children as RootContent[], file, stack, docsDir);
    }
  }
}

/** `<include>x</include>` alone on a line parses as inline JSX inside a paragraph; across lines it is a flow element. */
function isInclude(node: RootContent): boolean {
  if (node.type === 'mdxJsxFlowElement') return node.name === 'include';
  return (
    node.type === 'paragraph' &&
    node.children.length === 1 &&
    node.children[0]?.type === 'mdxJsxTextElement' &&
    node.children[0].name === 'include'
  );
}

function resolve(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export default remarkInclude;
