import { md, type ToMarkdown } from '@dockudos/core';
import type { ReactNode } from 'react';

export interface SectionProps {
  title?: string;
  /** A sentence under the title. */
  lead?: string;
  /** `muted` for a quiet band, `primary` for the brand color. */
  tone?: 'default' | 'muted' | 'primary';
  align?: 'start' | 'center';
  /** The id for links to this part of the page. */
  id?: string;
  children?: ReactNode;
}

/**
 * A full-width band of a landing page, holding a title, a lead sentence and any components (`Hero`, `Cards`,
 * `Columns`, `Tile`). Stack several on a page with `layout: landing`.
 */
export function Section({ title, lead, tone = 'default', align = 'start', id, children }: SectionProps) {
  return (
    <section className="dk-section" data-tone={tone} data-align={align} id={id}>
      <div className="dk-section-inner">
        {title && <h2 className="dk-section-title">{title}</h2>}
        {lead && <p className="dk-section-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

Section.toMarkdown = ((props, children) =>
  md.section([props.title && `## ${props.title}`, props.lead].filter(Boolean).join('\n\n'), children)) satisfies ToMarkdown<{
  title?: string;
  lead?: string;
}>;
