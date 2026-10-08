'use client';

import { useMemo } from 'react';
import { type GraphData, usePageData } from '../docs-context.tsx';
import { layoutGraph } from '../lib/graph-layout.ts';
import { useLink } from '../provider.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

const SIZE = 600;

/**
 * Every page as a node and every link between pages as an edge. The current
 * page is highlighted. Nodes are real links, so the graph works from the keyboard.
 */
export function GraphView({ data }: { data?: GraphData }) {
  const page = usePageData();
  const Link = useLink();
  const graph = data ?? page.graph;

  const positions = useMemo(
    () =>
      new Map(
        layoutGraph(
          graph?.nodes.map((n) => n.id) ?? [],
          graph?.edges ?? [],
          SIZE,
        ).map((p) => [p.id, p]),
      ),
    [graph],
  );
  if (!graph || graph.nodes.length === 0) return null;

  return (
    <figure
      data-print="hide"
      className="not-prose my-5 overflow-hidden rounded-lg border bg-card"
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label="Graph of pages and the links between them"
        className="h-auto w-full"
      >
        {graph.edges.map((e) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.from}>${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="stroke-border"
              strokeWidth={1}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const p = positions.get(node.id);
          if (!p) return null;
          const current = node.path === page.path;
          return (
            <Link
              key={node.id}
              href={node.path}
              aria-current={current ? 'page' : undefined}
              className="group outline-none"
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={current ? 8 : 6}
                className={`${current ? 'fill-primary' : 'fill-muted-foreground'} group-hover:fill-primary group-focus-visible:fill-primary group-focus-visible:stroke-ring`}
                strokeWidth={3}
              />
              <text
                x={p.x}
                y={p.y - 11}
                textAnchor="middle"
                className="fill-foreground text-[11px] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {node.title}
              </text>
              <title>{node.title}</title>
            </Link>
          );
        })}
      </svg>
      <figcaption className="sr-only">{graph.nodes.length} pages</figcaption>
    </figure>
  );
}

GraphView.toMarkdown = (() =>
  md.block(md.italic('A graph of how the pages of this site link to each other (interactive in the browser).'))) satisfies ToMarkdown;
