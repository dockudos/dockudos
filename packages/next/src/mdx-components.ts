import {
  type MdxComponentMap,
  defineMdxComponents as defineUiComponents,
} from '@dockudos/ui';
import { AutoTypeTable } from './auto-type-table.tsx';

/**
 * Every built-in MDX component, including the ones that need Node
 * (`AutoTypeTable`), with your overrides on top. Use it in `mdx-components.tsx`:
 *
 *     export const useMDXComponents = (c) => ({ ...defineMdxComponents({ Callout: MyCallout }), ...c });
 */
export function defineMdxComponents(
  overrides: MdxComponentMap = {},
): MdxComponentMap {
  return defineUiComponents({ AutoTypeTable, ...overrides });
}
