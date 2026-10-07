'use client';

import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  createContext,
  useContext,
  useMemo,
} from 'react';
import type { SvgIcon } from '@dockudos/core';

/** An icon as a React component: anything that takes SVG props and draws one icon. */
export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string }
>;

export interface IconRegistry {
  /** Icons read from SVG files (the `icons.packs` of docs.json), by `pack:name`. */
  data: Record<string, SvgIcon>;
  /** Icons that are React components, by name. */
  components: Record<string, IconComponent>;
}

const EMPTY: IconRegistry = { data: {}, components: {} };
const IconsContext = createContext<IconRegistry>(EMPTY);

/**
 * Makes your own icons available by name wherever an icon is accepted. Usually set up through
 * `DocsRoot` / `DocsProvider`, which take `icons` and `iconComponents`.
 */
export function IconsProvider({
  icons,
  components,
  children,
}: {
  icons?: Record<string, SvgIcon>;
  components?: Record<string, IconComponent>;
  children: ReactNode;
}) {
  const parent = useContext(IconsContext);
  const value = useMemo<IconRegistry>(
    () => ({
      data: { ...parent.data, ...icons },
      components: { ...parent.components, ...components },
    }),
    [parent, icons, components],
  );
  return (
    <IconsContext.Provider value={value}>{children}</IconsContext.Provider>
  );
}

/** The icons registered by your app, for building your own icon components. */
export const useIconRegistry = (): IconRegistry => useContext(IconsContext);
