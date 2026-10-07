'use client';

import { Check, Circle } from 'lucide-react';
import { type ReactNode, createContext, useContext } from 'react';
import { usePageData } from '../docs-context.tsx';
import { useLocalStorage } from '../hooks/use-local-storage.ts';
import { elementChildren } from '../lib/children.ts';

export interface ChecklistProps {
  /**
   * Makes the list tickable and remembers the ticks in this browser. Unique on the page; changing it
   * starts a fresh list. Without it the list is read-only.
   */
  id?: string;
  children: ReactNode;
}

interface ItemState {
  checked: boolean;
  toggle: () => void;
}

const ItemContext = createContext<ItemState | null>(null);

/**
 * A list of things to do or to check. With an `id` the reader can tick items, and the ticks are kept in
 * `localStorage`; without one it shows a fixed state.
 */
export function Checklist({ id, children }: ChecklistProps) {
  const { path } = usePageData();
  const [marks, setMarks] = useLocalStorage<Record<string, boolean>>(
    id ? `dockudos:checklist:${path}:${id}` : null,
    {},
  );
  if (!id) return <ul className="dk-checklist">{children}</ul>;

  const items = elementChildren<ChecklistItemProps>(children).map((el, i) => ({
    el,
    key: el.props.id ?? String(i),
  }));
  const isChecked = (key: string, initial?: boolean) =>
    marks[key] ?? initial ?? false;
  const done = items.filter((it) =>
    isChecked(it.key, it.el.props.checked),
  ).length;

  return (
    <div className="dk-checklist-group">
      <ul className="dk-checklist">
        {items.map(({ el, key }) => (
          <ItemContext.Provider
            key={key}
            value={{
              checked: isChecked(key, el.props.checked),
              toggle: () =>
                setMarks((prev) => ({
                  ...prev,
                  [key]: !isChecked(key, el.props.checked),
                })),
            }}
          >
            {el}
          </ItemContext.Provider>
        ))}
      </ul>
      <p className="dk-checklist-progress" data-print="hide">
        <span role="status">
          {done} of {items.length} done
        </span>
        {Object.keys(marks).length > 0 && (
          <button
            type="button"
            className="dk-checklist-reset"
            onClick={() => setMarks({})}
          >
            Reset
          </button>
        )}
      </p>
    </div>
  );
}

export interface ChecklistItemProps {
  /** Done or satisfied. In a tickable list this is the starting state. Default false. */
  checked?: boolean;
  /** Keeps the saved tick when items are reordered. Defaults to the item's position. */
  id?: string;
  children?: ReactNode;
}

export function ChecklistItem({
  checked = false,
  children,
}: ChecklistItemProps) {
  const state = useContext(ItemContext);
  const isChecked = state ? state.checked : checked;
  const icon = isChecked ? (
    <Check className="size-3.5" />
  ) : (
    <Circle className="size-3.5" />
  );
  return (
    <li className="dk-checklist-item" data-checked={isChecked ? '' : undefined}>
      {state ? (
        <label className="dk-checklist-label">
          <input
            type="checkbox"
            className="dk-checklist-input"
            checked={isChecked}
            onChange={state.toggle}
          />
          <span className="dk-checklist-box" aria-hidden="true">
            {icon}
          </span>
          <div>{children}</div>
        </label>
      ) : (
        <>
          <span className="dk-checklist-box" aria-hidden="true">
            {icon}
          </span>
          <span className="sr-only">{isChecked ? 'Done: ' : 'Not done: '}</span>
          <div>{children}</div>
        </>
      )}
    </li>
  );
}
