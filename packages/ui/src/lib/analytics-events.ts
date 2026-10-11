/**
 * Things readers do, announced as DOM events so any analytics can listen without the components knowing about it:
 *
 * - `dockudos:search`    `{ query, results }`   a search settled (results = 0 marks a failed search)
 * - `dockudos:feedback`  `{ path, value }`      a thumbs up (`up`) or down (`down`) on a page
 * - `dockudos:assistant` `{ query, value, cited }`   the assistant answered (`answered`) or could not (`unanswered`)
 *
 * They carry no identity. The dockudos platform's `analytics.js` forwards them; nothing is sent unless a listener exists.
 */
export type AnalyticsEvent =
  | { kind: 'search'; query: string; results: number }
  | { kind: 'feedback'; path: string; value: 'up' | 'down' }
  | { kind: 'assistant'; query: string; value: 'answered' | 'unanswered'; cited: string[] };

export function emitAnalytics(event: AnalyticsEvent): void {
  if (typeof window === 'undefined') return;
  const { kind, ...detail } = event;
  try {
    window.dispatchEvent(new CustomEvent(`dockudos:${kind}`, { detail }));
  } catch {
    // An analytics listener must never break the page.
  }
}
