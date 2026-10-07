import {
  EMBED_CONTEXT_MESSAGE,
  embedContextFromParams,
  embedUrl,
  parseContextMessage,
} from './embed.ts';

describe('embed', () => {
  it('builds the address of the embeddable assistant, with the context', () => {
    expect(embedUrl('https://docs.acme.com')).toBe(
      'https://docs.acme.com/embed',
    );
    expect(
      embedUrl('https://docs.acme.com/', {
        path: '/guides/billing',
        hint: 'Billing & plans',
      }),
    ).toBe(
      'https://docs.acme.com/embed?path=%2Fguides%2Fbilling&hint=Billing+%26+plans',
    );
    expect(embedUrl('https://docs.acme.com/some/page', {})).toBe(
      'https://docs.acme.com/embed',
    );
  });

  it('reads the context back from the query, from either kind of params', () => {
    expect(
      embedContextFromParams(
        new URLSearchParams('path=%2Fa&hint=Billing+%26+plans'),
      ),
    ).toEqual({ path: '/a', hint: 'Billing & plans' });
    expect(
      embedContextFromParams({ path: ['/a', '/b'], hint: undefined }),
    ).toEqual({ path: '/a' });
    expect(embedContextFromParams({})).toBeUndefined();
    expect(embedContextFromParams({ path: 'no-slash' })).toBeUndefined();
  });

  it('reads a context message, and ignores everything else', () => {
    expect(
      parseContextMessage({
        type: EMBED_CONTEXT_MESSAGE,
        context: { hint: 'Billing' },
      }),
    ).toEqual({ hint: 'Billing' });
    // A message to clear the context.
    expect(parseContextMessage({ type: EMBED_CONTEXT_MESSAGE })).toEqual({});
    expect(
      parseContextMessage({ type: 'something-else', context: { hint: 'x' } }),
    ).toBeUndefined();
    expect(parseContextMessage('hello')).toBeUndefined();
    expect(parseContextMessage(null)).toBeUndefined();
    expect(
      parseContextMessage({
        type: EMBED_CONTEXT_MESSAGE,
        context: { hint: 5, path: {} },
      }),
    ).toEqual({});
  });
});
