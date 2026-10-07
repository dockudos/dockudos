'use client';

import type { SearchHit, Snippet } from '@dockudos/core';
import { Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Shortcut } from '../components/shortcut.tsx';
import { useHotkey } from '../hooks/use-hotkey.ts';
import {
  type SearchSettings,
  useSearch,
  useSearchClient,
} from '../hooks/use-search.ts';
import { renderIcon } from '../components/render-icon.tsx';
import { useNavigate } from '../provider.tsx';

export interface PaletteEntry {
  title: string;
  path: string;
  /** The section it sits in: the group or tab. Shown dimmed and searched. */
  group?: string;
  description?: string;
  icon?: string;
}

const OPEN_EVENT = 'dockudos:palette';

/** Open the command palette from anywhere (the navbar button, your own code). */
export const openCommandPalette = () =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/**
 * How well `query` matches an entry: every word must appear, and title matches beat section and
 * description matches. 0 means no match. Exported for tests.
 */
export function scoreEntry(entry: PaletteEntry, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const title = entry.title.toLowerCase();
  const group = (entry.group ?? '').toLowerCase();
  const description = (entry.description ?? '').toLowerCase();
  let total = 0;
  for (const word of words) {
    let score = 0;
    if (title === word) score = 100;
    else if (title.startsWith(word)) score = 60;
    else if (title.split(/[^a-z0-9]+/).some((t) => t.startsWith(word)))
      score = 40;
    else if (title.includes(word)) score = 25;
    else if (group.includes(word)) score = 10;
    else if (description.includes(word)) score = 6;
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

/** The "Search" button for the navbar. */
export function PaletteButton() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="dk-search-button"
      aria-keyshortcuts="Control+K Meta+K /"
      aria-label="Search pages"
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="dk-search-label">Search</span>
      <Shortcut keys="mod+k" />
    </button>
  );
}

/** One line of the results: a page from the navigation, or a section found by full-text search. */
type Row =
  | { kind: 'page'; key: string; entry: PaletteEntry }
  | { kind: 'hit'; key: string; hit: SearchHit };

/** Text with the matched words marked. */
function Highlighted({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let at = 0;
  snippet.ranges.forEach(([start, end], i) => {
    if (start < at) return;
    if (start > at) parts.push(snippet.text.slice(at, start));
    parts.push(
      <mark
        key={i}
        className="rounded-sm bg-primary/20 font-medium text-foreground"
      >
        {snippet.text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < snippet.text.length) parts.push(snippet.text.slice(at));
  return <>{parts}</>;
}

/**
 * Find anything in the docs. Opens with Cmd or Ctrl + K, or `/`. Without a query it lists the pages;
 * as you type it searches every section of every page and shows where the words were found. Arrow keys
 * choose, Enter goes there (to the section, not just the page), Esc closes.
 *
 * `search` is the `search` key of docs.json. Without it the palette only matches page titles.
 */
export function CommandPalette({
  entries,
  search,
}: {
  entries: readonly PaletteEntry[];
  search?: SearchSettings;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const client = useSearchClient(search);
  // Hits know the page's title but not its icon or section; the navigation does.
  const byPath = useMemo(
    () => new Map(entries.map((e) => [e.path, e])),
    [entries],
  );
  const found = useSearch(client, open ? query : '', {
    limit: search?.limit,
  });

  useHotkey('mod+k', () => setOpen((o) => !o), {
    description: 'Search pages (also /)',
    group: 'General',
    // Cmd or Ctrl + K works while a field has focus too, and closes the palette again.
    allowInInputs: true,
  });
  useHotkey('/', () => setOpen(true));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  const pageRows = useMemo(
    () =>
      entries
        .map((entry, index) => ({
          entry,
          index,
          score: scoreEntry(entry, query),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) =>
          query ? b.score - a.score || a.index - b.index : a.index - b.index,
        )
        .slice(0, 50)
        .map(
          ({ entry }): Row => ({
            kind: 'page',
            key: `page:${entry.path}`,
            entry,
          }),
        ),
    [entries, query],
  );

  const searching = !!client && query.trim() !== '';
  // Results of full-text search, then pages whose title matches but that have no text to find.
  const rows = useMemo((): Row[] => {
    if (!searching || found.status === 'error') return pageRows;
    const hits = found.hits.map(
      (hit): Row => ({ kind: 'hit', key: `hit:${hit.id}`, hit }),
    );
    const covered = new Set(found.hits.map((h) => h.path));
    return [
      ...hits,
      ...pageRows.filter(
        (r) => r.kind === 'page' && !covered.has(r.entry.path),
      ),
    ];
  }, [searching, found, pageRows]);

  useEffect(() => setActive(0), [query, open, found.query]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, rows]);

  const go = (row: Row | undefined) => {
    if (!row) return;
    setOpen(false);
    setQuery('');
    navigate(row.kind === 'hit' ? row.hit.url : row.entry.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(rows.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(rows[active]);
    }
  };

  const waiting = searching && found.status === 'loading' && rows.length === 0;
  const status = waiting
    ? 'Searching…'
    : searching && found.status === 'error'
      ? 'Full-text search is unavailable. Showing matching page titles.'
      : query.trim()
        ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
        : '';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(36rem,94vw)] -translate-x-1/2 overflow-hidden rounded-xl border bg-background shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Search pages</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-4">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                rows[active] ? `${listId}-${active}` : undefined
              }
              aria-autocomplete="list"
              aria-label="Search pages"
              placeholder={client ? 'Search the docs…' : 'Search pages…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="m-0 max-h-[50vh] list-none overflow-y-auto p-2"
          >
            {rows.map((row, i) => (
              <li
                key={row.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(row)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                {row.kind === 'page' ? (
                  <>
                    {row.entry.icon && (
                      <span className="text-muted-foreground">
                        {renderIcon(row.entry.icon, 16)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.entry.title}
                      </span>
                      {row.entry.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.entry.description}
                        </span>
                      )}
                    </span>
                    {row.entry.group && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {row.entry.group}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {byPath.get(row.hit.path)?.icon && (
                      <span className="text-muted-foreground">
                        {renderIcon(byPath.get(row.hit.path)?.icon, 16)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.hit.title}
                        {row.hit.headingPath.length > 0 && (
                          <span className="font-normal text-muted-foreground">
                            {' › '}
                            {row.hit.headingPath.join(' › ')}
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        <Highlighted snippet={row.hit.snippet} />
                      </span>
                    </span>
                    {byPath.get(row.hit.path)?.group && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {byPath.get(row.hit.path)?.group}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && !waiting && (
              <li
                role="presentation"
                className="px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {client ? 'No results for' : 'No pages match'} “{query}”.
              </li>
            )}
          </ul>
          <div role="status" className="sr-only">
            {status}
          </div>
          <div
            className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            <span>↑↓ to move</span>
            <span>Enter to open</span>
            <span>Esc to close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
