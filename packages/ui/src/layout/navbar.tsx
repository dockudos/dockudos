'use client';

import type { DocsConfig } from '@dockudos/core';
import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useLink } from '../provider.tsx';
import { AssistantButton } from './assistant-panel.tsx';
import { PaletteButton } from './command-palette.tsx';
import { ThemeToggle } from '../theme/theme-toggle.tsx';
import type { TabLink } from './tab-links.ts';
import { useMessages } from '../messages-context.tsx';
import { withBase } from '../lib/base-path.ts';

function Brand({
  name,
  logo,
  brand,
}: {
  name: string;
  logo: DocsConfig['logo'];
  brand?: ReactNode;
}) {
  const Link = useLink();
  const href = typeof logo === 'object' ? (logo.href ?? '/') : '/';
  return (
    <Link href={href} className="dk-navbar-brand">
      {brand ?? (
        <>
          {typeof logo === 'string' && <img src={withBase(logo)} alt="" />}
          {typeof logo === 'object' && (
            <>
              <img src={withBase(logo.light)} alt="" className="dark:hidden" />
              <img
                src={withBase(logo.dark)}
                alt=""
                className="hidden dark:block"
              />
            </>
          )}
          {/* With a logo the name is still read out, just not shown twice. */}
          <span className={logo ? 'sr-only' : undefined}>{name}</span>
        </>
      )}
    </Link>
  );
}

function TabList({
  tabs,
  className,
}: {
  tabs: readonly TabLink[];
  className?: string;
}) {
  const Link = useLink();
  const t = useMessages();
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t('sections')} className={className}>
      {tabs.map((t) =>
        t.external ? (
          <a
            key={t.title}
            href={t.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Link
            key={t.title}
            href={t.href}
            aria-current={t.active ? 'true' : undefined}
          >
            {t.title}
          </Link>
        ),
      )}
    </nav>
  );
}

export function Navbar({
  name,
  logo,
  tabs,
  defaultMode,
  drawer,
  brand,
  search = false,
  assistant = false,
  extras,
}: {
  name: string;
  logo: DocsConfig['logo'];
  tabs: readonly TabLink[];
  defaultMode: 'light' | 'dark' | 'system';
  /** Sidebar content shown in the mobile drawer. */
  drawer: ReactNode;
  /** Replaces the logo and name. */
  brand?: ReactNode;
  /** Show the search button (the command palette). */
  search?: boolean;
  /** Show the "Ask AI" button (the assistant panel). */
  assistant?: boolean;
  /** Extra controls before the theme toggle, such as the version and language switchers. */
  extras?: ReactNode;
}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  return (
    <header className="dk-navbar">
      <Brand name={name} logo={logo} brand={brand} />
      <TabList tabs={tabs} className="dk-navbar-tabs" />
      <div className="dk-navbar-spacer" />
      {search && <PaletteButton />}
      {assistant && <AssistantButton />}
      {extras}
      <ThemeToggle defaultMode={defaultMode} />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="dk-menu-button inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('openNavigation')}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto border-r bg-background p-4 shadow-xl data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
            // Close after following a link in the drawer.
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setOpen(false);
            }}
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-semibold">{name}</Dialog.Title>
              <Dialog.Close
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('closeNavigation')}
              >
                <X className="size-5" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Site navigation
            </Dialog.Description>
            <TabList
              tabs={tabs}
              className="dk-drawer-tabs flex flex-wrap gap-2 text-sm"
            />
            {drawer}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
