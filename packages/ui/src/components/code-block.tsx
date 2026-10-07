import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { elementChildren } from '../lib/children.ts';
import { cn } from '../lib/utils.ts';
import { CopyButton } from './copy-button.tsx';
import { Tab, Tabs } from './tabs.tsx';

type PreProps = ComponentProps<'pre'> & {
  'data-title'?: string;
  'data-language'?: string;
  'data-line-numbers'?: string;
};

/**
 * A highlighted code block: optional title bar and a copy button.
 * The `<pre>` itself comes from Shiki, so it is keyboard-focusable when it scrolls.
 */
export function CodeBlock({ children, className, ...props }: PreProps) {
  const { 'data-title': title, ...pre } = props;
  return (
    <figure className="dk-code" data-has-title={title ? '' : undefined}>
      {title && <figcaption className="dk-code-title">{title}</figcaption>}
      <div className="dk-code-body">
        <pre className={cn('dk-pre', className)} {...pre}>
          {children}
        </pre>
        <CopyButton />
      </div>
    </figure>
  );
}

const titleOf = (el: ReactElement<{ 'data-title'?: string }>, i: number) =>
  el.props['data-title'] ?? `Tab ${i + 1}`;

/** Several code blocks as tabs, labelled by each block's `title`. */
export function CodeGroup({
  children,
  groupId,
}: {
  children: ReactNode;
  groupId?: string;
}) {
  const blocks = elementChildren<{ 'data-title'?: string }>(children);
  return (
    <Tabs
      items={blocks.map(titleOf)}
      groupId={groupId}
      className="dk-code-group"
    >
      {blocks.map((block, i) => (
        <Tab key={titleOf(block, i)} value={titleOf(block, i)}>
          {block}
        </Tab>
      ))}
    </Tabs>
  );
}
