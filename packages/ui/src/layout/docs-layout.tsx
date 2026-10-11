import {
  type DocsConfig,
  type LayoutName,
  type Navigation,
  type Page,
  type TocEntry,
  type Messages,
  type VariantUi,
  breadcrumb,
  findTab,
  flattenSidebar,
  messagesFor,
  prevNext,
  tutorialOf,
} from '@dockudos/core';
import type { ReactNode } from 'react';
import { type GraphData, PageDataProvider } from '../docs-context.tsx';
import { Kudos } from '../components/kudos.tsx';
import { PrintExpander } from './print-expander.tsx';
import { AskScopeSetter } from './ask-scope.tsx';
import { AssistantPanel } from './assistant-panel.tsx';
import { CommandPalette } from './command-palette.tsx';
import { MessagesProvider } from '../messages-context.tsx';
import { Navbar } from './navbar.tsx';
import { PageActions } from './page-actions.tsx';
import { PageShortcuts } from './page-shortcuts.tsx';
import { paletteEntries } from './palette-entries.ts';
import { ShortcutsDialog, ShortcutsHint } from './shortcuts-dialog.tsx';
import { tabLinks } from './tab-links.ts';
import { Breadcrumb, PrevNext } from './page-nav.tsx';
import { Sidebar } from './sidebar.tsx';
import { Toc } from './toc.tsx';
import {
  FallbackNotice,
  LanguageSwitcher,
  VersionBanner,
  VersionSwitcher,
} from './variant-controls.tsx';
import { TutorialHeader } from './tutorial-header.tsx';

/** Set by `dockudos build --static`: there is no server, so AI and feedback are left out. */
const STATIC_EXPORT = process.env.NEXT_PUBLIC_DOCKUDOS_STATIC === '1';
const STATIC_MARKDOWN = 'static';

export interface DocsLayoutProps {
  config: Pick<DocsConfig, 'name' | 'logo' | 'theme'> &
    Partial<
      Pick<
        DocsConfig,
        'kudos' | 'actions' | 'shortcuts' | 'seo' | 'search' | 'ai'
      >
    >;
  nav: Navigation;
  page: Page;
  toc: readonly TocEntry[];
  /** When the page last changed. Shown as "Last updated" when given. */
  lastModified?: Date;
  /** Pages and links between them, for `<GraphView />`. */
  graph?: GraphData;
  /** Replaces the logo and name in the navbar, for example `<Logo />`. */
  brand?: ReactNode;
  /** Version and language of the page: switchers, notices, text direction. From `site.variantUi(page)`. */
  variant?: VariantUi;
  /** Words of the interface in the page's language. Default: the bundled ones for `variant.lang`. */
  messages?: Messages;
  children: ReactNode;
}

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
  variant,
  messages,
  children,
}: DocsLayoutProps) {
  const words = messages ?? messagesFor(variant?.lang);
  const dateFormat = new Intl.DateTimeFormat(variant?.lang ?? 'en', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
  const layout: LayoutName = page.layout ?? config.theme.layout;
  const activeTab = findTab(nav, page.path) ?? nav.tabs.find((t) => !t.href);
  const sidebar = activeTab ? (
    <Sidebar items={activeTab.sidebar} path={page.path} />
  ) : null;
  const { prev, next } = prevNext(nav, page.path);
  const tutorial = tutorialOf(nav, page.path);
  const first = (tab: (typeof nav.tabs)[number]) =>
    flattenSidebar(tab.sidebar)[0]?.path;
  const shortcuts = config.shortcuts !== false;
  // Only what the browser needs. Never the provider, model or any address of the model's API.
  const ai =
    config.ai?.enabled && !STATIC_EXPORT
      ? {
          endpoint: config.ai.endpoint,
          navigateEndpoint: config.ai.navigateEndpoint,
          navigation: config.ai.navigation,
          maxQuestionLength: config.ai.limits.maxQuestionLength,
        }
      : undefined;
  const actions = config.actions;
  const siteUrl = config.seo?.siteUrl?.replace(/\/+$/, '');
  const editUrl = actions?.editUrl
    ?.replaceAll('{file}', page.file)
    .replaceAll('{path}', page.path);
  const prevLink = prev && { path: prev.path, title: prev.title };
  const nextLink = next && { path: next.path, title: next.title };

  return (
    <MessagesProvider messages={words}>
      <div
        className="dk-shell"
        data-layout={layout}
        lang={variant?.lang}
        dir={variant?.dir}
      >
        <AskScopeSetter locale={variant?.lang} version={variant?.version} />
        <a className="dk-skip" href="#dk-content">
          {words.skipToContent}
        </a>
        <Navbar
          name={config.name}
          logo={config.logo}
          brand={brand}
          tabs={tabLinks(nav.tabs, first, activeTab)}
          defaultMode={config.theme.mode}
          drawer={sidebar}
          search={shortcuts}
          assistant={shortcuts && !!ai}
          extras={
            variant && (
              <>
                <LanguageSwitcher locales={variant.locales} />
                <VersionSwitcher versions={variant.versions} />
              </>
            )
          }
        />
        <div className="dk-body">
          <aside className="dk-sidebar" aria-label={words.sidebar}>
            {sidebar}
          </aside>
          <main id="dk-content" className="dk-main" tabIndex={-1}>
            <PrintExpander />
            {shortcuts && (
              <>
                <PageShortcuts
                  prev={prevLink}
                  next={nextLink}
                  home={nav.tabs.map(first).find(Boolean)}
                />
                <CommandPalette
                  entries={paletteEntries(nav)}
                  search={
                    config.search && {
                      ...config.search,
                      scope: {
                        locale: variant?.lang,
                        version: variant?.version,
                      },
                    }
                  }
                  ai={ai}
                />
                {ai && (
                  <AssistantPanel
                    endpoint={ai.endpoint}
                    maxQuestionLength={ai.maxQuestionLength}
                  />
                )}
                <ShortcutsDialog />
              </>
            )}
            <article className="dk-article">
              {variant?.banner && <VersionBanner banner={variant.banner} />}
              {variant?.fallback && (
                <FallbackNotice fallback={variant.fallback} />
              )}
              <Breadcrumb crumbs={breadcrumb(nav, page.path)} />
              {tutorial && (
                <TutorialHeader
                  title={tutorial.title}
                  step={tutorial.step}
                  steps={tutorial.steps.map((p) => ({
                    path: p.path,
                    title: p.sidebarTitle ?? p.title,
                  }))}
                />
              )}
              <h1 className="dk-page-title">{page.title}</h1>
              {page.description && (
                <p className="dk-page-description">{page.description}</p>
              )}
              {actions && (actions.copyPage || actions.editUrl) && (
                <PageActions
                  path={page.path}
                  title={page.title}
                  markdownEndpoint={
                    actions.copyPage
                      ? STATIC_EXPORT
                        ? STATIC_MARKDOWN
                        : actions.endpoint
                      : undefined
                  }
                  editUrl={editUrl}
                  pageUrl={
                    actions.assistants && siteUrl
                      ? `${siteUrl}${page.path}`
                      : undefined
                  }
                />
              )}
              <div className="dk-prose">
                <PageDataProvider
                  value={{
                    toc,
                    graph,
                    path: page.path,
                    title: page.title,
                    prev: prevLink,
                    next: nextLink,
                  }}
                >
                  {children}
                </PageDataProvider>
              </div>
              {tutorial && tutorial.step === tutorial.steps.length && (
                <p className="dk-tutorial-complete" role="status">
                  You have finished {tutorial.title}.
                </p>
              )}
              {(lastModified || shortcuts) && (
                <div className="dk-article-footer">
                  {lastModified ? (
                    <p className="dk-last-modified">
                      {words.lastUpdated}{' '}
                      <time dateTime={lastModified.toISOString()}>
                        {dateFormat.format(lastModified)}
                      </time>
                    </p>
                  ) : (
                    <span />
                  )}
                  {shortcuts && <ShortcutsHint />}
                </div>
              )}
              {config.kudos?.enabled &&
                page.kudos !== false &&
                !STATIC_EXPORT && (
                  <Kudos path={page.path} endpoint={config.kudos.endpoint} />
                )}
              <PrevNext prev={prev} next={next} />
            </article>
          </main>
          <aside className="dk-toc" aria-label={words.onThisPage}>
            <Toc entries={toc} />
          </aside>
        </div>
      </div>
    </MessagesProvider>
  );
}
