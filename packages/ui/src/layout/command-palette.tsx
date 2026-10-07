'use client';

import { Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Shortcut } from '../components/shortcut.tsx';
import { useHotkey } from '../hooks/use-hotkey.ts';
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

/**
 * Jump to any page by typing part of its title. Opens with Cmd or Ctrl + K, or `/`. Arrow keys
 * choose, Enter goes there, Esc closes. Keeps the last query out of the way: it starts empty.
 */
export function CommandPalette({
  entries,
}: {
  entries: readonly PaletteEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

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

  const results = useMemo(
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
        .map((r) => r.entry),
    [entries, query],
  );

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  const go = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    setQuery('');
    navigate(entry.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(results.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    }
  };

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
                results[active] ? `${listId}-${active}` : undefined
              }
              aria-autocomplete="list"
              aria-label="Search pages"
              placeholder="Search pages…"
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
            aria-label="Pages"
            className="m-0 max-h-[50vh] list-none overflow-y-auto p-2"
          >
            {results.map((entry, i) => (
              <li
                key={entry.path}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(entry)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                {entry.icon && (
                  <span className="text-muted-foreground">
                    {renderIcon(entry.icon, 16)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {entry.title}
                  </span>
                  {entry.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.description}
                    </span>
                  )}
                </span>
                {entry.group && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.group}
                  </span>
                )}
              </li>
            ))}
            {results.length === 0 && (
              <li
                role="presentation"
                className="px-3 py-6 text-center text-sm text-muted-foreground"
              >
                No pages match “{query}”.
              </li>
            )}
          </ul>
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
