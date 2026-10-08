import type { ReactNode } from 'react';
import { CodeGroup } from './code-block.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

/**
 * A side panel for examples. On wide screens it sits in the right-hand column, replacing the table of
 * contents, and stays in view while the page scrolls; on narrow screens and on paper it is inline.
 */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <aside className="dk-panel" aria-label="Examples">
      {children}
    </aside>
  );
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="dk-example" aria-label={label}>
      <h4 className="dk-example-label">{label}</h4>
      {children}
    </section>
  );
}

/**
 * A request example: code blocks as tabs, one per language. Put it in a `Panel` to pin it beside the text.
 * Each code block's `title` names its tab.
 */
export function RequestExample({ children }: { children: ReactNode }) {
  return (
    <Example label="Request">
      <CodeGroup groupId="request-language">{children}</CodeGroup>
    </Example>
  );
}

/** A response example, in the same form as `RequestExample`. */
export function ResponseExample({ children }: { children: ReactNode }) {
  return (
    <Example label="Response">
      <CodeGroup groupId="response-language">{children}</CodeGroup>
    </Example>
  );
}

Panel.toMarkdown = md.container;
RequestExample.toMarkdown = ((_props, children) => md.section(md.bold('Request example'), children)) satisfies ToMarkdown;
ResponseExample.toMarkdown = ((_props, children) => md.section(md.bold('Response example'), children)) satisfies ToMarkdown;
