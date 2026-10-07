'use client';

import {
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
} from 'react';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

function DefaultLink(props: LinkProps) {
  return <a {...props} />;
}

const defaultNavigate = (href: string) => {
  window.location.assign(href);
};

interface Host {
  Link: ComponentType<LinkProps>;
  navigate: (href: string) => void;
}

const HostContext = createContext<Host>({
  Link: DefaultLink,
  navigate: defaultNavigate,
});

/**
 * Lets the host framework supply its client-side router, so the UI stays independent of Next.js.
 * `Link` renders links; `navigate` is for shortcuts and the command palette. Without a provider,
 * plain anchors and a full page load are used.
 */
export function DocsProvider({
  Link = DefaultLink,
  navigate = defaultNavigate,
  children,
}: {
  Link?: ComponentType<LinkProps>;
  navigate?: (href: string) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ Link, navigate }), [Link, navigate]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export const useLink = () => useContext(HostContext).Link;

/** Go to a page, with the framework's router. For your own shortcuts and components. */
export const useNavigate = () => useContext(HostContext).navigate;
