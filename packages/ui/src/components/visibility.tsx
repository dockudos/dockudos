import type { ReactNode } from 'react';

export const AUDIENCES = ['humans', 'agents'] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface VisibilityProps {
  /**
   * Who the content is for: `humans` is shown on the website; `agents` is left out of the website
   * and kept in the Markdown version of the page, which AI tools read.
   */
  for: Audience;
  children?: ReactNode;
}

/** Content for one audience. On the website only `for="humans"` is shown. */
export function Visibility({ for: audience, children }: VisibilityProps) {
  if (!AUDIENCES.includes(audience)) {
    throw new Error(
      `<Visibility for="${String(audience)}">: use "humans" or "agents"`,
    );
  }
  return audience === 'humans' ? <>{children}</> : null;
}
