'use client';

import type { SearchBackend, SvgIcon } from '@dockudos/core';
import { DocsProvider, type IconComponent, type LinkProps } from '@dockudos/ui';
import NextLink from 'next/link.js';
import { useRouter } from 'next/navigation.js';
import { type ComponentType, type ReactNode, useCallback } from 'react';

// Under `nodenext` the default import of this CommonJS module is typed as the
// module namespace; bundlers give the component itself.
const Link = NextLink as unknown as ComponentType<LinkProps>;

/** Put this in the root layout so the docs UI navigates with Next's client-side router. */
export function DocsRoot({
  icons,
  iconComponents,
  searchBackend,
  children,
}: {
  /** Your SVG icon packs: `site.icons`. */
  icons?: Record<string, SvgIcon>;
  /**
   * Your icons as React components, by name (see `iconPack`). Functions cannot be passed from a server
   * component, so use `DocsRoot` from a small client component of your own when you need this.
   */
  iconComponents?: Record<string, IconComponent>;
  /** Your own search backend, in place of the one `search` in docs.json selects. Only from a client component. */
  searchBackend?: SearchBackend;
  children: ReactNode;
}) {
  const router = useRouter();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  return (
    <DocsProvider
      Link={Link}
      navigate={navigate}
      icons={icons}
      iconComponents={iconComponents}
      searchBackend={searchBackend}
    >
      {children}
    </DocsProvider>
  );
}
