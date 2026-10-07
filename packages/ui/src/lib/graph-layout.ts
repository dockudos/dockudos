export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

/**
 * Force-directed layout (Fruchterman-Reingold) in a `size` x `size` box.
 * Deterministic: nodes start on a circle, so the same graph always draws the same.
 * Work is capped so large sites stay fast: fewer iterations as the node count grows.
 */
export function layoutGraph(
  ids: readonly string[],
  edges: readonly { from: string; to: string }[],
  size = 600,
): LayoutNode[] {
  const n = ids.length;
  if (n === 0) return [];
  const pad = 30;
  const c = size / 2;
  const radius = size / 2 - pad;

  const pos = ids.map((id, i) => ({
    id,
    x: n === 1 ? c : c + radius * Math.cos((2 * Math.PI * i) / n),
    y: n === 1 ? c : c + radius * Math.sin((2 * Math.PI * i) / n),
  }));
  if (n === 1) return pos;

  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges.flatMap((e) => {
    const a = index.get(e.from);
    const b = index.get(e.to);
    return a !== undefined && b !== undefined && a !== b
      ? [[a, b] as const]
      : [];
  });

  const k = Math.sqrt((size * size) / n) * 0.6;
  const iterations = Math.max(
    20,
    Math.min(150, Math.floor(4_000_000 / (n * n))),
  );
  let temperature = size / 8;

  for (let it = 0; it < iterations; it++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ux = (pos[i] as LayoutNode).x - (pos[j] as LayoutNode).x;
        let uy = (pos[i] as LayoutNode).y - (pos[j] as LayoutNode).y;
        let d = Math.hypot(ux, uy);
        if (d < 0.01) {
          ux = 0.01 * (i - j);
          uy = 0.01;
          d = Math.hypot(ux, uy);
        }
        const f = (k * k) / d;
        dx[i] = (dx[i] as number) + (ux / d) * f;
        dy[i] = (dy[i] as number) + (uy / d) * f;
        dx[j] = (dx[j] as number) - (ux / d) * f;
        dy[j] = (dy[j] as number) - (uy / d) * f;
      }
    }
    for (const [a, b] of links) {
      const ux = (pos[a] as LayoutNode).x - (pos[b] as LayoutNode).x;
      const uy = (pos[a] as LayoutNode).y - (pos[b] as LayoutNode).y;
      const d = Math.max(Math.hypot(ux, uy), 0.01);
      const f = (d * d) / k;
      dx[a] = (dx[a] as number) - (ux / d) * f;
      dy[a] = (dy[a] as number) - (uy / d) * f;
      dx[b] = (dx[b] as number) + (ux / d) * f;
      dy[b] = (dy[b] as number) + (uy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i] as LayoutNode;
      const len = Math.max(Math.hypot(dx[i] as number, dy[i] as number), 0.01);
      const step = Math.min(len, temperature);
      p.x = Math.min(
        size - pad,
        Math.max(pad, p.x + ((dx[i] as number) / len) * step),
      );
      p.y = Math.min(
        size - pad,
        Math.max(pad, p.y + ((dy[i] as number) / len) * step),
      );
    }
    temperature *= 0.95;
  }
  return pos;
}
