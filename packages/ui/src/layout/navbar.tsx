'use client';

import type { DocsConfig } from '@dockudos/core';
import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useLink } from '../provider.tsx';
import { ThemeToggle } from '../theme/theme-toggle.tsx';
import type { TabLink } from './tab-links.ts';

function Brand({ name, logo }: { name: string; logo: DocsConfig['logo'] }) {
  const Link = useLink();
  const href = typeof logo === 'object' ? (logo.href ?? '/') : '/';
  return (
    <Link href={href} className="dk-navbar-brand">
      {typeof logo === 'string' && <img src={logo} alt="" />}
      {typeof logo === 'object' && (
        <>
          <img src={logo.light} alt="" className="dark:hidden" />
          <img src={logo.dark} alt="" className="hidden dark:block" />
        </>
      )}
      <span>{name}</span>
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
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Sections" className={className}>
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
}: {
  name: string;
  logo: DocsConfig['logo'];
  tabs: readonly TabLink[];
  defaultMode: 'light' | 'dark' | 'system';
  /** Sidebar content shown in the mobile drawer. */
  drawer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="dk-navbar">
      <Brand name={name} logo={logo} />
      <TabList tabs={tabs} className="dk-navbar-tabs" />
      <div className="dk-navbar-spacer" />
      <ThemeToggle defaultMode={defaultMode} />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="dk-menu-button inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open navigation"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto border-r bg-background p-4 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
            // Close after following a link in the drawer.
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setOpen(false);
            }}
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-semibold">{name}</Dialog.Title>
              <Dialog.Close
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close navigation"
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
