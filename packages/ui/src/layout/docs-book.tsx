import {
  type DocsConfig,
  type Navigation,
  type Page,
  type SidebarItem,
  type TocEntry,
} from '@dockudos/core';
import type { ReactNode } from 'react';
import { PageDataProvider } from '../docs-context.tsx';
import { bookKey } from './book-key.ts';
import { BookLinks } from './book-links.tsx';
import { PrintExpander } from './print-expander.tsx';

export interface BookSection {
  page: Page;
  toc: readonly TocEntry[];
  /** The rendered page content. */
  node: ReactNode;
}

export interface DocsBookProps {
  config: Pick<DocsConfig, 'name'>;
  nav: Navigation;
  sections: readonly BookSection[];
  /** Shown on the cover. */
  generatedAt?: Date;
}

const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

function Contents({
  items,
  present,
}: {
  items: readonly SidebarItem[];
  present: ReadonlySet<string>;
}) {
  const shown = items.filter(
    (i): i is Extract<SidebarItem, { type: 'page' | 'group' }> =>
      i.type === 'group' || (i.type === 'page' && present.has(i.page.path)),
  );
  if (shown.length === 0) return null;
  return (
    <ul>
      {shown.map((item, i) =>
        item.type === 'page' ? (
          <li key={item.page.path}>
            <a href={`#${bookKey(item.page.path)}`}>
              {item.page.sidebarTitle ?? item.page.title}
            </a>
          </li>
        ) : (
          <li key={`${item.title}-${i}`}>
            <span className="dk-book-group">{item.title}</span>
            <Contents items={item.items} present={present} />
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * Every page in one document: a cover, a table of contents, then each page starting on a new sheet.
 * Meant for the PDF (`dockudos pdf`) and for printing the whole site from the browser.
 */
export function DocsBook({
  config,
  nav,
  sections,
  generatedAt,
}: DocsBookProps) {
  const present = new Set(sections.map((s) => s.page.path));
  const listed = new Set(
    nav.tabs
      .flatMap((t) => t.sidebar)
      .flatMap(function collect(i): string[] {
        return i.type === 'page'
          ? [i.page.path]
          : i.type === 'group'
            ? i.items.flatMap(collect)
            : [];
      }),
  );
  const unlisted = sections.filter((s) => !listed.has(s.page.path));

  return (
    <div className="dk-book">
      <PrintExpander />
      <BookLinks />

      <header className="dk-book-cover">
        <h1 className="dk-book-title">{config.name}</h1>
        <p className="dk-book-subtitle">Documentation</p>
        {generatedAt && (
          <p className="dk-book-date">
            <time dateTime={generatedAt.toISOString()}>
              {dateFormat.format(generatedAt)}
            </time>
          </p>
        )}
      </header>

      <nav className="dk-book-toc" aria-label="Contents">
        <h2>Contents</h2>
        {nav.tabs
          .filter((t) => !t.href)
          .map((tab) => (
            <section key={tab.title}>
              {nav.tabs.filter((t) => !t.href).length > 1 && (
                <h3>{tab.title}</h3>
              )}
              <Contents items={tab.sidebar} present={present} />
            </section>
          ))}
        {unlisted.length > 0 && (
          <section>
            <h3>More</h3>
            <ul>
              {unlisted.map((s) => (
                <li key={s.page.path}>
                  <a href={`#${bookKey(s.page.path)}`}>{s.page.title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>

      {sections.map(({ page, toc, node }) => (
        <section
          key={page.path}
          id={bookKey(page.path)}
          data-book-path={page.path}
          className="dk-book-page"
        >
          <h1 className="dk-page-title">{page.title}</h1>
          {page.description && (
            <p className="dk-page-description">{page.description}</p>
          )}
          <div className="dk-prose">
            <PageDataProvider value={{ toc, path: page.path }}>
              {node}
            </PageDataProvider>
          </div>
        </section>
      ))}
    </div>
  );
}
