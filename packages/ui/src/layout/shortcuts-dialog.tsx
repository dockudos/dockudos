'use client';

import { Keyboard, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { Shortcut } from '../components/shortcut.tsx';
import { useHotkey, useRegisteredHotkeys } from '../hooks/use-hotkey.ts';

const OPEN_EVENT = 'dockudos:shortcuts';

/** Open the keyboard shortcuts dialog from anywhere (a button, your own code). */
export const openShortcuts = () =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/**
 * The list of keyboard shortcuts, opened with `?`. It shows every shortcut registered with
 * `useHotkey` that has a description, grouped, so the list is never out of date.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const entries = useRegisteredHotkeys();

  useHotkey('?', () => setOpen((o) => !o), {
    description: 'Show keyboard shortcuts',
    group: 'General',
  });
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = entry.group ?? 'General';
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 shadow-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <Keyboard className="size-4" aria-hidden="true" /> Keyboard
              shortcuts
            </Dialog.Title>
            <Dialog.Close
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {[...groups].map(([group, list]) => (
            <section key={group} className="mt-4">
              <h3 className="m-0 mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
              </h3>
              <ul className="m-0 list-none p-0">
                {list.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-4 border-b py-2 text-sm last:border-0"
                  >
                    <span>{e.description}</span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1">
                      {e.keys.map((k) => (
                        <Shortcut key={k} keys={k} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A small "Keyboard shortcuts ?" button for the page footer. */
export function ShortcutsHint() {
  return (
    <button
      type="button"
      className="dk-shortcuts-hint"
      onClick={openShortcuts}
      data-print="hide"
    >
      <Keyboard className="size-3.5" aria-hidden="true" /> Keyboard shortcuts{' '}
      <Shortcut keys="?" />
    </button>
  );
}
