'use client';

import { ICON_NAMES, Icon, useCopyToClipboard } from '@dockudos/ui';
import { useState } from 'react';

/**
 * Every icon you can use by name. A custom component built from the dockudos hooks: clicking an icon
 * copies its name with `useCopyToClipboard`.
 */
export function IconGallery() {
  const [filter, setFilter] = useState('');
  const [last, setLast] = useState<string>();
  const { copy } = useCopyToClipboard();
  const names = ICON_NAMES.filter((n) =>
    n.includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="not-prose my-5">
      <label className="mb-3 block text-sm">
        <span className="sr-only">Filter icons</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${ICON_NAMES.length} icons…`}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-4">
        {names.map((name) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => {
                void copy(name);
                setLast(name);
              }}
              className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Copy icon name ${name}`}
            >
              <Icon name={name} size={16} />
              <span className="truncate font-mono">{name}</span>
            </button>
          </li>
        ))}
      </ul>
      {names.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No icon matches “{filter}”.
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className="mt-2 text-xs text-muted-foreground"
      >
        {last ? `Copied “${last}”` : 'Click an icon to copy its name.'}
      </p>
    </div>
  );
}
