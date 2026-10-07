'use client';

import { useEffect } from 'react';

/**
 * In the book every page shares one document, so two pages can have a heading with the same id,
 * and a link to another page would leave the file. This gives each heading an id that starts with
 * its page's key, and points links between pages (and within a page) at those ids, so links in the
 * PDF go to the right place. It sets `data-book-ready` on `<body>` when it is done.
 */
export function BookLinks() {
  useEffect(() => {
    const sections = [
      ...document.querySelectorAll<HTMLElement>('[data-book-path]'),
    ];
    const keys = new Map(
      sections.map((s) => [s.dataset['bookPath'] as string, s.id]),
    );

    for (const section of sections) {
      const key = section.id;
      section
        .querySelectorAll<HTMLElement>(
          'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
        )
        .forEach((h) => {
          h.id = `${key}--${h.id}`;
        });
      section.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        const raw = a.getAttribute('href') ?? '';
        if (raw.startsWith('#')) {
          a.setAttribute('href', `#${key}--${raw.slice(1)}`);
          return;
        }
        let url: URL;
        try {
          url = new URL(a.href, location.href);
        } catch {
          return;
        }
        if (url.origin !== location.origin) return;
        const path =
          url.pathname.length > 1
            ? url.pathname.replace(/\/+$/, '')
            : url.pathname;
        const target = keys.get(path);
        if (!target) return;
        a.setAttribute(
          'href',
          url.hash ? `#${target}--${url.hash.slice(1)}` : `#${target}`,
        );
      });
    }
    document.body.dataset['bookReady'] = '1';
    return () => {
      delete document.body.dataset['bookReady'];
    };
  }, []);
  return null;
}
