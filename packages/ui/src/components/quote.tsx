import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

export interface QuoteProps {
  /** Who said it. */
  author?: string;
  /** Their role or where it was said: "CTO, Acme", "Release notes". */
  source?: string;
  /** A link to the original. */
  href?: string;
  children: ReactNode;
}

/** A pull quote or testimonial, with its author and source. */
export function Quote({ author, source, href, children }: QuoteProps) {
  const credit = [author, source].filter(Boolean).join(', ');
  return (
    <figure className="dk-quote">
      <blockquote cite={href}>{children}</blockquote>
      {credit && (
        <figcaption>
          {'— '}
          {href ? (
            <a href={href} rel="noreferrer noopener">
              {credit}
            </a>
          ) : (
            credit
          )}
        </figcaption>
      )}
    </figure>
  );
}

Quote.toMarkdown = ((props, children) => {
  const by = [md.text(props.author), md.text(props.source)].filter(Boolean).join(', ');
  return md.quote('', undefined, children, by ? `— ${md.link(by, md.text(props.href))}` : undefined);
}) satisfies ToMarkdown<{ author?: string; source?: string; href?: string }>;
