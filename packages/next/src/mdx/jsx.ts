import type { Code, RootContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import type { MdxjsEsm } from 'mdast-util-mdxjs-esm';

/** An MDX JSX element with string attributes, as the compiler would parse `<Name a="b">…</Name>`. */
export function jsx(
  name: string,
  attributes: Record<string, string | undefined>,
  children: RootContent[] = [],
): MdxJsxFlowElement {
  return {
    type: 'mdxJsxFlowElement',
    name,
    attributes: Object.entries(attributes).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [
            {
              type: 'mdxJsxAttribute',
              name: key,
              value,
            } satisfies MdxJsxAttribute,
          ],
    ),
    children: children as MdxJsxFlowElement['children'],
  };
}

export function codeNode(
  lang: string,
  value: string,
  meta?: string | null,
): Code {
  return { type: 'code', lang, meta: meta ?? null, value };
}

const program = (body: object[]) => ({
  type: 'Program',
  sourceType: 'module',
  body,
});

/** `import 'specifier'` (side-effect import, e.g. a stylesheet). */
export function sideEffectImport(specifier: string): MdxjsEsm {
  const source = {
    type: 'Literal',
    value: specifier,
    raw: JSON.stringify(specifier),
  };
  return {
    type: 'mdxjsEsm',
    value: `import ${JSON.stringify(specifier)}`,
    data: {
      estree: program([
        { type: 'ImportDeclaration', specifiers: [], source },
      ]) as never,
    },
  };
}

/** `import local from 'specifier'`. */
export function defaultImport(local: string, specifier: string): MdxjsEsm {
  const source = {
    type: 'Literal',
    value: specifier,
    raw: JSON.stringify(specifier),
  };
  return {
    type: 'mdxjsEsm',
    value: `import ${local} from ${JSON.stringify(specifier)}`,
    data: {
      estree: program([
        {
          type: 'ImportDeclaration',
          specifiers: [
            {
              type: 'ImportDefaultSpecifier',
              local: { type: 'Identifier', name: local },
            },
          ],
          source,
        },
      ]) as never,
    },
  };
}

/** Attribute whose value is a JS identifier, e.g. `src={img0}`. */
export function identifierAttribute(
  name: string,
  identifier: string,
): MdxJsxAttribute {
  return {
    type: 'mdxJsxAttribute',
    name,
    value: {
      type: 'mdxJsxAttributeValueExpression',
      value: identifier,
      data: {
        estree: program([
          {
            type: 'ExpressionStatement',
            expression: { type: 'Identifier', name: identifier },
          },
        ]) as never,
      },
    },
  };
}
