import type { ReactNode } from 'react';
import { Badge } from './badge.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

export interface SinceProps {
  /** The version that introduced it: `1.4`. */
  version: string;
}

/** An inline label for when something appeared: `Since 1.4`. */
export function Since({ version }: SinceProps) {
  return <Badge color="green">Since {version}</Badge>;
}

export interface DeprecatedProps {
  /** The version that deprecated it. */
  since?: string;
  /** What to use instead, shown after the label. */
  replacedBy?: string;
  /** Extra explanation, shown after the label. */
  children?: ReactNode;
}

/** An inline label for something on its way out, with what to use instead. */
export function Deprecated({ since, replacedBy, children }: DeprecatedProps) {
  return (
    <>
      <Badge color="red">Deprecated{since ? ` in ${since}` : ''}</Badge>
      {replacedBy && (
        <>
          {' '}
          Use <code>{replacedBy}</code> instead.
        </>
      )}
      {children && <> {children}</>}
    </>
  );
}

Since.toMarkdown = ((props) => md.italic(`Since ${props.version}`)) satisfies ToMarkdown<{ version: string }>;
Deprecated.toMarkdown = ((props, children) =>
  md.section(
    md.bold(`Deprecated${props.since ? ` since ${props.since}` : ''}${props.replacedBy ? `, use ${props.replacedBy} instead` : ''}.`),
    children,
  )) satisfies ToMarkdown<{ since?: string; replacedBy?: string }>;
