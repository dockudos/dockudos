import { defineMdxComponents } from '@dockudos/ui';
import type { MDXComponents } from 'mdx/types';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...defineMdxComponents(), ...components };
}
