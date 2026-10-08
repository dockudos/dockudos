'use client';

import {
  type ReactNode,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react';
import { renderIcon } from './render-icon.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

const STORAGE_KEY = 'dockudos-view';

/**
 * All Views on the page share one selection. They register their titles here, so the first View can
 * draw a single selector that lists every title.
 */
const store = (() => {
  let entries: { id: string; title: string }[] = [];
  let selected: string | undefined;
  let snapshot = { entries, selected };
  const listeners = new Set<() => void>();
  const emit = () => {
    snapshot = { entries, selected };
    listeners.forEach((l) => l());
  };
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: () => snapshot,
    register(id: string, title: string) {
      entries = [...entries, { id, title }];
      if (selected === undefined) {
        try {
          selected = localStorage.getItem(STORAGE_KEY) ?? undefined;
        } catch {
          // storage unavailable: start with the first view
        }
      }
      emit();
      return () => {
        entries = entries.filter((e) => e.id !== id);
        emit();
      };
    },
    select(title: string) {
      selected = title;
      try {
        localStorage.setItem(STORAGE_KEY, title);
      } catch {
        // the choice lasts for this page view only
      }
      emit();
    },
  };
})();

const SERVER = { entries: [], selected: undefined };

export interface ViewProps {
  /** Names this view. Views with the same title on a page are shown together. */
  title: string;
  /** An icon name or an element, shown in the selector's label. */
  icon?: string | ReactNode;
  children?: ReactNode;
}

/**
 * Content for one language, framework or setup. Give several Views on a page different titles and
 * a selector appears above the first one: the reader sees one view at a time. Without scripting,
 * and on paper, every view is shown.
 */
export function View({ title, icon, children }: ViewProps) {
  const id = useId();
  const [mounted, setMounted] = useState(false);
  const { entries, selected } = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => SERVER,
  );

  useEffect(() => {
    setMounted(true);
    return store.register(id, title);
  }, [id, title]);

  const titles = [...new Set(entries.map((e) => e.title))];
  const active = titles.includes(selected ?? '') ? selected : titles[0];
  const first = entries[0]?.id === id;

  return (
    <>
      {mounted && first && titles.length > 1 && (
        <div className="dk-view-bar" data-print="hide">
          <label>
            <span className="dk-view-label">View</span>
            <select
              value={active}
              onChange={(e) => store.select(e.target.value)}
            >
              {titles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <section
        className="dk-view"
        data-view={title}
        aria-label={title}
        style={
          mounted && titles.length > 1 && active !== title
            ? { display: 'none' }
            : undefined
        }
      >
        {icon && (
          <span className="dk-view-icon" data-print="hide">
            {renderIcon(icon, 14)}
          </span>
        )}
        {children}
      </section>
    </>
  );
}

View.toMarkdown = ((props, children) => md.section(md.bold(props.title), children)) satisfies ToMarkdown<{ title: string }>;
