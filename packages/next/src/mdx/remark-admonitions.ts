import type {} from 'mdast-util-directive';
import type { Root, RootContent, Text } from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import { toString } from 'mdast-util-to-string';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

export const ADMONITION_TYPES = [
  'note',
  'info',
  'tip',
  'warning',
  'danger',
] as const;

/**
 * Turn `:::note Title ... :::` blocks into `<Callout type="note" title="Title">`.
 * Needs `remark-directive`, which also parses `:word` inside prose, so
 * text and leaf directives that are not ours are restored to the text the
 * author wrote (`10:30`, `std::vector`).
 */
const remarkAdmonitions: Plugin<[], Root> = () => (tree) => {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return;

    if (node.type === 'textDirective' || node.type === 'leafDirective') {
      const restored = restoreDirective(node);
      parent.children.splice(index, 1, ...restored);
      return [SKIP, index + restored.length];
    }

    if (node.type === 'containerDirective') {
      const type = node.name.toLowerCase();
      if (!(ADMONITION_TYPES as readonly string[]).includes(type)) return;

      // `:::note[Title]` puts the title in a paragraph flagged `directiveLabel`.
      const [first, ...rest] = node.children;
      const hasLabel =
        first?.type === 'paragraph' &&
        first.data &&
        'directiveLabel' in first.data;
      const title = hasLabel ? toString(first) : undefined;

      const callout: MdxJsxFlowElement = {
        type: 'mdxJsxFlowElement',
        name: 'Callout',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'type', value: type },
          ...(title
            ? [
                {
                  type: 'mdxJsxAttribute' as const,
                  name: 'title',
                  value: title,
                },
              ]
            : []),
        ],
        children: (hasLabel
          ? rest
          : node.children) as MdxJsxFlowElement['children'],
      };
      parent.children.splice(index, 1, callout);
      return [SKIP, index];
    }
    return;
  });
};

function restoreDirective(node: {
  type: 'textDirective' | 'leafDirective';
  name: string;
  children: RootContent[];
}): RootContent[] {
  const label = node.children.length
    ? `[${toString({ type: 'paragraph', children: node.children } as never)}]`
    : '';
  const text: Text = {
    type: 'text',
    value: `${node.type === 'leafDirective' ? '::' : ':'}${node.name}${label}`,
  };
  return [text];
}

export default remarkAdmonitions;
