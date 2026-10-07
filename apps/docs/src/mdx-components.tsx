import { defineMdxComponents } from '@dockudos/next/mdx-components';
import type { MDXComponents } from 'mdx/types';
import { IconGallery } from './icon-gallery.tsx';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...defineMdxComponents({ IconGallery }), ...components };
}
