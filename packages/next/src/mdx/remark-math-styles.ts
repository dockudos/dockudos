import type {} from 'mdast-util-math';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { sideEffectImport } from './jsx.ts';

export interface RemarkMathStylesOptions {
  /** Module specifier of KaTeX's stylesheet, resolved from the page being compiled. */
  css: string;
}

/**
 * Adds the KaTeX stylesheet import to pages that contain math, and only those,
 * so the ~25 kB of CSS is never loaded elsewhere.
 */
const remarkMathStyles: Plugin<[RemarkMathStylesOptions], Root> =
  ({ css }) =>
  (tree) => {
    let hasMath = false;
    visit(tree, (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') hasMath = true;
      return hasMath ? false : undefined;
    });
    if (hasMath) tree.children.unshift(sideEffectImport(css));
  };

export default remarkMathStyles;
