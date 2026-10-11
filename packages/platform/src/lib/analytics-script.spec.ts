import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_SCRIPT } from './analytics-script.ts';

const SITE = '123e4567-e89b-12d3-a456-426614174000';

/** Run the script against a small fake browser. */
function browser({ dnt = false, gpc = false, site = SITE, beacon = true, referrer = 'https://news.example.com/post?x=1' } = {}) {
  const sent: { url: string; body: any }[] = [];
  const fetched: { url: string; init: any }[] = [];
  const listeners = new Map<string, ((e: any) => void)[]>();
  const timers: (() => void)[] = [];
  const loc = { pathname: '/guide' };
  const hist = { pushState: (..._a: unknown[]) => undefined, replaceState: (..._a: unknown[]) => undefined };
  const win: any = {
    doNotTrack: dnt ? '1' : undefined,
    location: loc, history: hist,
    addEventListener: (n: string, f: (e: any) => void) => listeners.set(n, [...(listeners.get(n) ?? []), f]),
  };
  const nav: any = { doNotTrack: dnt ? '1' : '0', globalPrivacyControl: gpc, sendBeacon: beacon ? (url: string, body: string) => (sent.push({ url, body: JSON.parse(body) }), true) : undefined };
  const doc: any = {
    currentScript: { getAttribute: (k: string) => (k === 'data-site' ? site : null), src: 'https://platform.example.com/analytics.js' },
    readyState: 'complete', referrer, addEventListener: vi.fn(),
  };
  const run = new Function('window', 'document', 'navigator', 'location', 'history', 'addEventListener', 'fetch', 'setTimeout', 'URL', ANALYTICS_SCRIPT);
  run(win, doc, nav, loc, hist, win.addEventListener, async (url: string, init: any) => { fetched.push({ url, init }); sent.push({ url, body: JSON.parse(init.body) }); return {}; }, (fn: () => void) => timers.push(fn), URL);
  return {
    sent, fetched, win,
    emit: (name: string, detail: unknown) => (listeners.get(name) ?? []).forEach((f) => f({ detail })),
    flush: () => { while (timers.length) timers.shift()!(); },
    go: (path: string) => { loc.pathname = path; hist.pushState(); },
    listeners,
  };
}

describe('analytics.js', () => {
  it('sends one page view with the referrer, to the platform that served the script', () => {
    const b = browser();
    expect(b.sent).toEqual([{ url: `https://platform.example.com/api/v1/ingest/${SITE}`, body: { kind: 'pageview', path: '/guide', referrer: 'https://news.example.com/post?x=1' } }]);
  });

  it('follows client-side navigation, once per path, without a referrer after the first', () => {
    const b = browser();
    b.go('/guide/auth');
    b.flush();
    b.go('/guide/auth');
    b.flush();
    b.go('/guide');
    b.flush();
    expect(b.sent.map((s) => s.body.path)).toEqual(['/guide', '/guide/auth', '/guide']);
    expect(b.sent.slice(1).every((s) => !('referrer' in s.body))).toBe(true);
  });

  it('forwards what the UI announces', () => {
    const b = browser();
    b.emit('dockudos:search', { query: 'webhooks', results: 0 });
    b.emit('dockudos:feedback', { path: '/guide', value: 'down' });
    b.emit('dockudos:assistant', { query: 'how?', value: 'unanswered', cited: [] });
    expect(b.sent.slice(1).map((s) => s.body)).toEqual([
      { kind: 'search', query: 'webhooks', results: 0 },
      { kind: 'feedback', path: '/guide', value: 'down' },
      { kind: 'assistant', query: 'how?', value: 'unanswered', cited: [] },
    ]);
  });

  it('exposes a track() for anything else', () => {
    const b = browser();
    b.win.dockudosAnalytics.track({ kind: 'feedback', path: '/x', value: 'up' });
    expect(b.sent.at(-1)!.body).toEqual({ kind: 'feedback', path: '/x', value: 'up' });
  });

  it('falls back to fetch without credentials when there is no beacon', () => {
    const b = browser({ beacon: false });
    expect(b.fetched[0]!.init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true });
  });

  it('does nothing at all for Do Not Track, Global Privacy Control, or a missing or malformed site id', () => {
    for (const opts of [{ dnt: true }, { gpc: true }, { site: '' }, { site: 'not-a-uuid' }]) {
      const b = browser(opts);
      expect(b.sent, JSON.stringify(opts)).toEqual([]);
      expect(b.listeners.size).toBe(0);
    }
  });

  it('uses no cookies or storage', () => {
    expect(ANALYTICS_SCRIPT).not.toMatch(/cookie|localStorage|sessionStorage|indexedDB/);
  });
});
