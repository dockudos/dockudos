'use client';

import {
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
  createContext,
  useContext,
} from 'react';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

function DefaultLink(props: LinkProps) {
  return <a {...props} />;
}

const LinkContext = createContext<ComponentType<LinkProps>>(DefaultLink);

/**
 * Lets the host framework supply its client-side router link, so the UI stays
 * independent of Next.js. Without a provider, plain anchors are rendered.
 */
export function DocsProvider({
  Link = DefaultLink,
  children,
}: {
  Link?: ComponentType<LinkProps>;
  children: ReactNode;
}) {
  return <LinkContext.Provider value={Link}>{children}</LinkContext.Provider>;
}

export const useLink = () => useContext(LinkContext);
