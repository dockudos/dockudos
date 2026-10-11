/**
 * Things readers do, announced as DOM events so any analytics can listen without the components knowing about it:
 *
 * One window event, `dockudos:track`, whose `detail` says what happened:
 *
 * - `{ kind: 'search', query, results }`      a search settled (results = 0 marks a failed search)
 * - `{ kind: 'feedback', path, value }`       a thumbs up (`up`) or down (`down`) on a page
 * - `{ kind: 'assistant', query, value, cited }`   the assistant answered (`answered`) or could not (`unanswered`)
 *
 * They carry no identity. The dockudos platform's `analytics.js` forwards them; nothing is sent unless a listener exists.
 * (A separate `dockudos:assistant` event already exists and opens the assistant panel; this one must not reuse it.)
 */
export type AnalyticsEvent =
  | { kind: 'search'; query: string; results: number }
  | { kind: 'feedback'; path: string; value: 'up' | 'down' }
  | {
      kind: 'assistant';
      query: string;
      value: 'answered' | 'unanswered';
      cited: string[];
    };

export function emitAnalytics(event: AnalyticsEvent): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('dockudos:track', { detail: event }));
  } catch {
    // An analytics listener must never break the page.
  }
}
