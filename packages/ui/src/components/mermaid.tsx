'use client';

import { useEffect, useId, useState } from 'react';
import { type ToMarkdown } from '@dockudos/core';

/**
 * A Mermaid diagram, rendered in the browser. The library is fetched only
 * when a diagram is on the page, and the diagram re-renders when the theme
 * changes. Until then (and if it fails) the diagram source is shown.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        const dark = document.documentElement.classList.contains('dark');
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        const out = await mermaid.render(id, chart);
        if (!cancelled) setSvg(out.svg);
      } catch {
        if (!cancelled) setSvg(undefined);
      }
    };
    void render();
    const observer = new MutationObserver(() => void render());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chart, id]);

  return (
    <figure
      role="img"
      aria-label="Diagram"
      className="not-prose my-5 overflow-x-auto rounded-lg border bg-card p-4 text-center"
    >
      {svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="m-0 text-left text-sm">{chart}</pre>
      )}
    </figure>
  );
}

Mermaid.toMarkdown = ((props, _children, { fence }) =>
  props.chart ? fence(`\`\`\`mermaid\n${props.chart.trim()}\n\`\`\``) : '') satisfies ToMarkdown<{ chart?: string }>;
