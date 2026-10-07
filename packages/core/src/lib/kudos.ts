/** One line of the kudos log. A vote has `vote`; a follow-up comment has `comment` and the same `id`. */
export interface KudosEntry {
  id: string;
  /** ISO time. */
  at: string;
  path: string;
  vote?: 'up' | 'down';
  comment?: string;
}

export interface PageKudos {
  path: string;
  up: number;
  down: number;
  /** Comments in the order they arrived, each with the vote it belongs to when known. */
  comments: { at: string; vote?: 'up' | 'down'; text: string }[];
}

export interface KudosSummary {
  pages: PageKudos[];
  up: number;
  down: number;
  /** Lines that could not be read, so a damaged log is visible instead of silently shrinking. */
  skipped: number;
}

/** Parse one JSON-lines log. Unreadable lines are counted, not fatal. */
export function parseKudosLog(text: string): {
  entries: KudosEntry[];
  skipped: number;
} {
  const entries: KudosEntry[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<KudosEntry>;
      const valid =
        typeof e.id === 'string' &&
        typeof e.at === 'string' &&
        typeof e.path === 'string' &&
        (e.vote === undefined || e.vote === 'up' || e.vote === 'down') &&
        (e.comment === undefined || typeof e.comment === 'string') &&
        (e.vote !== undefined || e.comment !== undefined);
      if (valid) entries.push(e as KudosEntry);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

/** Totals per page, busiest first, from log entries. */
export function summarizeKudos(
  entries: readonly KudosEntry[],
  skipped = 0,
): KudosSummary {
  const voteById = new Map<string, 'up' | 'down'>();
  for (const e of entries) if (e.vote) voteById.set(e.id, e.vote);

  const pages = new Map<string, PageKudos>();
  const page = (path: string) => {
    let p = pages.get(path);
    if (!p) pages.set(path, (p = { path, up: 0, down: 0, comments: [] }));
    return p;
  };
  for (const e of entries) {
    const p = page(e.path);
    if (e.vote) p[e.vote]++;
    if (e.comment)
      p.comments.push({ at: e.at, vote: voteById.get(e.id), text: e.comment });
  }
  const list = [...pages.values()].sort(
    (a, b) => b.up + b.down - (a.up + a.down) || a.path.localeCompare(b.path),
  );
  return {
    pages: list,
    up: list.reduce((n, p) => n + p.up, 0),
    down: list.reduce((n, p) => n + p.down, 0),
    skipped,
  };
}
