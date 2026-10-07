'use client';

import { DocsProvider, type LinkProps } from '@dockudos/ui';
import NextLink from 'next/link.js';
import { useRouter } from 'next/navigation.js';
import { type ComponentType, type ReactNode, useCallback } from 'react';

// Under `nodenext` the default import of this CommonJS module is typed as the
// module namespace; bundlers give the component itself.
const Link = NextLink as unknown as ComponentType<LinkProps>;

/** Put this in the root layout so the docs UI navigates with Next's client-side router. */
export function DocsRoot({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  return (
    <DocsProvider Link={Link} navigate={navigate}>
      {children}
    </DocsProvider>
  );
}
