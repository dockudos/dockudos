type Labels = Record<string, string | number>;

const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map(
      (k) =>
        `${k}="${String(labels[k]).replace(/[\\"\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`))}"`,
    )
    .join(',');

interface Series {
  labels: Labels;
  value: number;
}

/** A small Prometheus-format registry: counters, gauges and histograms. No dependency, no global state. */
export class MetricsRegistry {
  private readonly metrics = new Map<
    string,
    {
      help: string;
      type: 'counter' | 'gauge' | 'histogram';
      series: Map<string, Series>;
      buckets?: number[];
      hist?: Map<
        string,
        { labels: Labels; counts: number[]; sum: number; count: number }
      >;
    }
  >();

  private metric(
    name: string,
    help: string,
    type: 'counter' | 'gauge' | 'histogram',
    buckets?: number[],
  ) {
    let m = this.metrics.get(name);
    if (!m) {
      m = {
        help,
        type,
        series: new Map(),
        ...(buckets && { buckets, hist: new Map() }),
      };
      this.metrics.set(name, m);
    }
    return m;
  }

  counter(name: string, help: string) {
    const m = this.metric(name, help, 'counter');
    return {
      inc: (labels: Labels = {}, by = 1) => {
        const k = key(labels);
        const s = m.series.get(k) ?? { labels, value: 0 };
        s.value += by;
        m.series.set(k, s);
      },
    };
  }

  gauge(name: string, help: string) {
    const m = this.metric(name, help, 'gauge');
    return {
      set: (value: number, labels: Labels = {}) =>
        m.series.set(key(labels), { labels, value }),
    };
  }

  histogram(
    name: string,
    help: string,
    buckets = [0.005, 0.025, 0.1, 0.5, 1, 5, 30],
  ) {
    const m = this.metric(name, help, 'histogram', buckets);
    return {
      observe: (value: number, labels: Labels = {}) => {
        const k = key(labels);
        const h = m.hist!.get(k) ?? {
          labels,
          counts: buckets.map(() => 0),
          sum: 0,
          count: 0,
        };
        buckets.forEach((b, i) => {
          if (value <= b) h.counts[i]! += 1;
        });
        h.sum += value;
        h.count += 1;
        m.hist!.set(k, h);
      },
    };
  }

  /** The Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    const fmt = (name: string, labels: Labels, value: number) => {
      const k = key(labels);
      return `${name}${k ? `{${k}}` : ''} ${value}`;
    };
    for (const [name, m] of [...this.metrics].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`# HELP ${name} ${m.help}`, `# TYPE ${name} ${m.type}`);
      if (m.type === 'histogram') {
        for (const h of m.hist!.values()) {
          m.buckets!.forEach((b, i) =>
            lines.push(
              fmt(`${name}_bucket`, { ...h.labels, le: b }, h.counts[i]!),
            ),
          );
          lines.push(
            fmt(`${name}_bucket`, { ...h.labels, le: '+Inf' }, h.count),
          );
          lines.push(
            fmt(`${name}_sum`, h.labels, h.sum),
            fmt(`${name}_count`, h.labels, h.count),
          );
        }
      } else
        for (const s of m.series.values())
          lines.push(fmt(name, s.labels, s.value));
    }
    return `${lines.join('\n')}\n`;
  }
}
