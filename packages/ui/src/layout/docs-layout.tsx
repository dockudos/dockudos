import {
  type DocsConfig,
  type LayoutName,
  type Navigation,
  type Page,
  type TocEntry,
  breadcrumb,
  findTab,
  flattenSidebar,
  prevNext,
} from '@dockudos/core';
import type { ReactNode } from 'react';
import { type GraphData, PageDataProvider } from '../docs-context.tsx';
import { Kudos } from '../components/kudos.tsx';
import { PrintExpander } from './print-expander.tsx';
import { Navbar } from './navbar.tsx';
import { tabLinks } from './tab-links.ts';
import { Breadcrumb, PrevNext } from './page-nav.tsx';
import { Sidebar } from './sidebar.tsx';
import { Toc } from './toc.tsx';

export interface DocsLayoutProps {
  config: Pick<DocsConfig, 'name' | 'logo' | 'theme'> &
    Partial<Pick<DocsConfig, 'kudos'>>;
  nav: Navigation;
  page: Page;
  toc: readonly TocEntry[];
  /** When the page last changed. Shown as "Last updated" when given. */
  lastModified?: Date;
  /** Pages and links between them, for `<GraphView />`. */
  graph?: GraphData;
  /** Replaces the logo and name in the navbar, for example `<Logo />`. */
  brand?: ReactNode;
  children: ReactNode;
}

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

/**
 * The page frame: navbar with tabs, sidebar, article and table of contents.
 * The layout comes from the page's `layout` frontmatter, else `theme.layout`.
 */
export function DocsLayout({
  config,
  nav,
  page,
  toc,
  lastModified,
  graph,
  brand,
  children,
}: DocsLayoutProps) {
  const layout: LayoutName = page.layout ?? config.theme.layout;
  const activeTab = findTab(nav, page.path) ?? nav.tabs.find((t) => !t.href);
  const sidebar = activeTab ? (
    <Sidebar items={activeTab.sidebar} path={page.path} />
  ) : null;
  const { prev, next } = prevNext(nav, page.path);
  const first = (tab: (typeof nav.tabs)[number]) =>
    flattenSidebar(tab.sidebar)[0]?.path;

  return (
    <div className="dk-shell" data-layout={layout}>
      <a className="dk-skip" href="#dk-content">
        Skip to content
      </a>
      <Navbar
        name={config.name}
        logo={config.logo}
        brand={brand}
        tabs={tabLinks(nav.tabs, first, activeTab)}
        defaultMode={config.theme.mode}
        drawer={sidebar}
      />
      <div className="dk-body">
        <aside className="dk-sidebar" aria-label="Sidebar">
          {sidebar}
        </aside>
        <main id="dk-content" className="dk-main" tabIndex={-1}>
          <PrintExpander />
          <article className="dk-article">
            <Breadcrumb crumbs={breadcrumb(nav, page.path)} />
            <h1 className="dk-page-title">{page.title}</h1>
            {page.description && (
              <p className="dk-page-description">{page.description}</p>
            )}
            <div className="dk-prose">
              <PageDataProvider value={{ toc, graph, path: page.path }}>
                {children}
              </PageDataProvider>
            </div>
            {lastModified && (
              <p className="dk-last-modified">
                Last updated{' '}
                <time dateTime={lastModified.toISOString()}>
                  {dateFormat.format(lastModified)}
                </time>
              </p>
            )}
            {config.kudos?.enabled && page.kudos !== false && (
              <Kudos path={page.path} endpoint={config.kudos.endpoint} />
            )}
            <PrevNext prev={prev} next={next} />
          </article>
        </main>
        <aside className="dk-toc" aria-label="Table of contents">
          <Toc entries={toc} />
        </aside>
      </div>
    </div>
  );
}
