import { defineMdxComponents } from '@dockudos/next/mdx-components';
import type { MDXComponents } from 'mdx/types';

// Add your own components here, or replace a built-in one by name:
//   defineMdxComponents({ Callout: MyCallout })
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...defineMdxComponents(), ...components };
}
