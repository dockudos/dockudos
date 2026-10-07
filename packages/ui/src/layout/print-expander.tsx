'use client';

import { useEffect } from 'react';

/**
 * Opens every `<details>` and shows every tab panel while printing, and puts them back afterwards,
 * so collapsed content is not missing from paper. Modern browsers also get this from CSS alone;
 * the script covers the ones that cannot (`::details-content`).
 */
export function PrintExpander() {
  useEffect(() => {
    const opened: HTMLDetailsElement[] = [];
    const shown: HTMLElement[] = [];

    const before = () => {
      document
        .querySelectorAll<HTMLDetailsElement>('.dk-prose details:not([open])')
        .forEach((d) => {
          d.open = true;
          opened.push(d);
        });
      document
        .querySelectorAll<HTMLElement>('.dk-prose [role="tabpanel"]')
        .forEach((p) => {
          if (p.style.display !== 'none') return;
          p.style.display = '';
          shown.push(p);
        });
    };
    const after = () => {
      for (const d of opened.splice(0)) d.open = false;
      for (const p of shown.splice(0)) p.style.display = 'none';
    };

    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return null;
}
