import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';

// Placeholder until `@dockudos/ui` provides the Callout (P1.15).
function Callout({
  type,
  title,
  children,
}: {
  type: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside data-callout={type}>
      {title && <strong>{title}</strong>}
      {children}
    </aside>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { Callout, ...components };
}
