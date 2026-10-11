import type { AskEvent } from '@dockudos/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitAnalytics } from './analytics-events.ts';
import { createAskStore } from './ask-store.ts';

const listen = (name: string) => {
  const seen: unknown[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener(`dockudos:${name}`, on);
  return { seen, stop: () => window.removeEventListener(`dockudos:${name}`, on) };
};
const sse = (...events: AskEvent[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const source = { n: 1, title: 'Auth', path: '/auth', anchor: 'keys', url: '/auth#keys', headingPath: ['Keys'] };

afterEach(() => vi.unstubAllGlobals());

describe('emitAnalytics', () => {
  it('announces each kind of event with its details and nothing else', () => {
    const search = listen('search');
    const feedback = listen('feedback');
    emitAnalytics({ kind: 'search', query: 'webhooks', results: 0 });
    emitAnalytics({ kind: 'feedback', path: '/guide', value: 'down' });
    expect(search.seen).toEqual([{ query: 'webhooks', results: 0 }]);
    expect(feedback.seen).toEqual([{ path: '/guide', value: 'down' }]);
    search.stop();
    feedback.stop();
  });

  it('never throws, even when a listener does or there is no window', () => {
    const bad = () => { throw new Error('listener bug'); };
    window.addEventListener('dockudos:search', bad);
    expect(() => emitAnalytics({ kind: 'search', query: 'q', results: 1 })).not.toThrow();
    window.removeEventListener('dockudos:search', bad);
    vi.stubGlobal('window', undefined);
    expect(() => emitAnalytics({ kind: 'search', query: 'q', results: 1 })).not.toThrow();
  });
});

describe('the assistant announces what happened to a question', () => {
  it('answered, with the pages it cited', async () => {
    const heard = listen('assistant');
    const store = createAskStore({ fetch: vi.fn(async () => sse({ type: 'sources', items: [source] }, { type: 'token', text: 'Rotate it [1].' }, { type: 'done', citations: [1] })) as never, storage: null });
    await store.ask('How do I rotate a key?');
    expect(heard.seen).toEqual([{ query: 'How do I rotate a key?', value: 'answered', cited: ['/auth'] }]);
    heard.stop();
  });

  it('unanswered when it refused or cited nothing', async () => {
    const heard = listen('assistant');
    const refused = createAskStore({ fetch: vi.fn(async () => sse({ type: 'done', citations: [], refused: 'no-context' })) as never, storage: null });
    await refused.ask('What is the meaning of life?');
    const uncited = createAskStore({ fetch: vi.fn(async () => sse({ type: 'sources', items: [source] }, { type: 'token', text: 'Maybe.' }, { type: 'done', citations: [] })) as never, storage: null });
    await uncited.ask('Something vague');
    expect(heard.seen).toEqual([
      { query: 'What is the meaning of life?', value: 'unanswered', cited: [] },
      { query: 'Something vague', value: 'unanswered', cited: [] },
    ]);
    heard.stop();
  });
});
