'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';
import { useCopyToClipboard } from '../hooks/use-copy-to-clipboard.ts';
import { md, type ToMarkdown } from '@dockudos/core';

export interface ColorItem {
  name: string;
  /** Any CSS color: `#4f46e5`, `oklch(0.5 0.2 270)`, `var(--primary)`. */
  value: string;
}

/**
 * A palette: click a swatch to copy its value. For brand and design-token pages.
 * `<Colors items={[{ name: 'Primary', value: '#4f46e5' }]} />`
 */
export function Colors({
  items,
  title,
}: {
  items: ColorItem[];
  title?: string;
}) {
  const { copy } = useCopyToClipboard();
  const [last, setLast] = useState<string>();
  return (
    <figure className="dk-colors not-prose">
      {title && <figcaption className="dk-colors-title">{title}</figcaption>}
      <ul>
        {items.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              onClick={() => {
                void copy(item.value);
                setLast(item.name);
              }}
              aria-label={`Copy ${item.name}, ${item.value}`}
            >
              <span
                className="dk-swatch"
                style={{ background: item.value }}
                aria-hidden="true"
              >
                {last === item.name && <Check className="size-4" />}
              </span>
              <span className="dk-swatch-name">{item.name}</span>
              <code className="dk-swatch-value">{item.value}</code>
            </button>
          </li>
        ))}
      </ul>
      <span role="status" aria-live="polite" className="sr-only">
        {last ? `Copied ${last}` : ''}
      </span>
    </figure>
  );
}

Colors.toMarkdown = ((props) =>
  md.block(
    props.title && md.bold(props.title),
    md.table(
      ['Name', 'Value'],
      (props.items ?? []).map((i) => [i.name, md.code(i.value)]),
    ),
  )) satisfies ToMarkdown<{ title?: string; items?: { name: string; value: string }[] }>;
