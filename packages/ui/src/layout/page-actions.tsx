'use client';

import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Shortcut } from '../components/shortcut.tsx';
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard.ts';
import { useHotkey } from '../hooks/use-hotkey.ts';

export interface PageActionsProps {
  /** Site path of the page. */
  path: string;
  title: string;
  /** Copy the page as Markdown, from this endpoint (`?path=` is added). Leave out to hide the action. */
  markdownEndpoint?: string;
  /** Link to edit the page's source. Leave out to hide the action. */
  editUrl?: string;
  /** Public address of the page, to hand to an AI assistant. Leave out to hide those actions. */
  pageUrl?: string;
}

const item =
  'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';

/**
 * Page tools above the content: copy the page as Markdown (shortcut `c`), open it as plain
 * Markdown, ask an AI assistant about it, and edit the source (shortcut `e`).
 */
export function PageActions({
  path,
  title,
  markdownEndpoint,
  editUrl,
  pageUrl,
}: PageActionsProps) {
  const { copy, state } = useCopyToClipboard();
  const [failed, setFailed] = useState(false);

  const markdownUrl = markdownEndpoint
    ? `${markdownEndpoint}?path=${encodeURIComponent(path)}`
    : undefined;
  const prompt = pageUrl
    ? `Read ${pageUrl} so I can ask questions about it.`
    : undefined;

  const copyPage = async () => {
    if (!markdownUrl) return;
    setFailed(false);
    try {
      const res = await fetch(markdownUrl);
      if (!res.ok) throw new Error(String(res.status));
      await copy(await res.text());
    } catch {
      setFailed(true);
    }
  };

  useHotkey('c', () => void copyPage(), {
    description: 'Copy this page as Markdown',
    group: 'Page',
    enabled: !!markdownUrl,
  });
  useHotkey('e', () => editUrl && window.open(editUrl, '_blank', 'noopener'), {
    description: 'Edit this page',
    group: 'Page',
    enabled: !!editUrl,
  });

  if (!markdownUrl && !editUrl) return null;
  const copied = state === 'copied';

  return (
    <div className="dk-page-actions" data-print="hide">
      {markdownUrl && (
        <div className="dk-split">
          <button
            type="button"
            className="dk-split-main"
            onClick={() => void copyPage()}
            aria-keyshortcuts="c"
            title="Copy page as Markdown (C)"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy page'}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="dk-split-more"
              aria-label={`More actions for ${title}`}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
              >
                <DropdownMenu.Item
                  className={item}
                  onSelect={() => void copyPage()}
                >
                  <Copy className="size-4" aria-hidden="true" /> Copy as
                  Markdown
                  <span className="ml-auto">
                    <Shortcut keys="c" />
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild className={item}>
                  <a
                    href={markdownUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <FileText className="size-4" aria-hidden="true" /> View as
                    Markdown
                    <ExternalLink
                      className="ml-auto size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </a>
                </DropdownMenu.Item>
                {prompt && (
                  <>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                    <DropdownMenu.Item asChild className={item}>
                      <a
                        href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Sparkles className="size-4" aria-hidden="true" /> Open
                        in ChatGPT
                        <ExternalLink
                          className="ml-auto size-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </a>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild className={item}>
                      <a
                        href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Sparkles className="size-4" aria-hidden="true" /> Open
                        in Claude
                        <ExternalLink
                          className="ml-auto size-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </a>
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {editUrl && (
        <a
          className="dk-page-edit"
          href={editUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-keyshortcuts="e"
          title="Edit this page (E)"
        >
          <Pencil className="size-4" aria-hidden="true" /> Edit
          <span className="sr-only"> this page (opens in a new tab)</span>
        </a>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copied
          ? 'Page copied as Markdown'
          : failed || state === 'failed'
            ? 'Could not copy the page'
            : ''}
      </span>
    </div>
  );
}
