'use client';

import type { TocEntry } from '@dockudos/core';
import { type ReactNode, createContext, useContext } from 'react';

export interface GraphData {
  nodes: { id: string; title: string; path: string }[];
  edges: { from: string; to: string }[];
}

interface PageData {
  toc: readonly TocEntry[];
  graph?: GraphData;
  path: string;
}

const PageContext = createContext<PageData>({ toc: [], path: '/' });

/** Gives page-aware MDX components (`InlineToc`, `GraphView`) their data. Rendered by `DocsLayout`. */
export function PageDataProvider({
  value,
  children,
}: {
  value: PageData;
  children: ReactNode;
}) {
  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

export const usePageData = () => useContext(PageContext);
