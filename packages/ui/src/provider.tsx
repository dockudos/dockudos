'use client';

import {
  type IconComponent,
  IconsProvider,
} from './components/icons-context.tsx';
import type { SvgIcon } from '@dockudos/core';
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
  icons,
  iconComponents,
  children,
}: {
  Link?: ComponentType<LinkProps>;
  navigate?: (href: string) => void;
  /** Icons read from your SVG packs (`site.icons`). */
  icons?: Record<string, SvgIcon>;
  /** Your icons as React components, by name. Only from a client component (functions cannot cross the server boundary). */
  iconComponents?: Record<string, IconComponent>;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ Link, navigate }), [Link, navigate]);
  return (
    <HostContext.Provider value={value}>
      <IconsProvider icons={icons} components={iconComponents}>
        {children}
      </IconsProvider>
    </HostContext.Provider>
  );
}

export const useLink = () => useContext(HostContext).Link;

/** Go to a page, with the framework's router. For your own shortcuts and components. */
export const useNavigate = () => useContext(HostContext).navigate;
