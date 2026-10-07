import {
  EMBED_CLOSE_MESSAGE,
  EMBED_CONTEXT_MESSAGE,
  EMBED_READY_MESSAGE,
} from '@dockudos/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAskStore } from '../lib/ask-store.ts';
import { DocsAssistant } from './docs-assistant.tsx';
import { EmbeddedAssistant } from './embedded-assistant.tsx';

describe('DocsAssistant', () => {
  it('shows only a button until it is opened, then the docs’ assistant in a frame', async () => {
    const user = userEvent.setup();
    render(
      <DocsAssistant
        siteUrl="https://docs.acme.com/some/page"
        context={{ hint: 'Billing settings', path: '/guides/billing' }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Ask AI' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('iframe')).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.title).toBe('Ask the docs');
    expect(frame.src).toBe(
      'https://docs.acme.com/embed?path=%2Fguides%2Fbilling&hint=Billing+settings',
    );
    expect(screen.getByRole('dialog', { name: 'Ask the docs' })).toBeVisible();
  });

  it('closes with Escape and the close button and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<DocsAssistant siteUrl="https://docs.acme.com" label="Help" />);
    const button = screen.getByRole('button', { name: 'Help' });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('sends changes of context to the open frame, to the docs origin only', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DocsAssistant siteUrl="https://docs.acme.com/x" context={{ hint: 'One' }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post } });
    rerender(<DocsAssistant siteUrl="https://docs.acme.com/x" context={{ hint: 'Two' }} />);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        { type: EMBED_CONTEXT_MESSAGE, context: { hint: 'Two' } },
        'https://docs.acme.com',
      ),
    );
    // The frame keeps the address it opened with; the message does the rest.
    expect(frame.src).toContain('hint=One');
  });

  it('sends the context when the frame says it is ready, and only to its own frame', async () => {
    const user = userEvent.setup();
    render(<DocsAssistant siteUrl="https://docs.acme.com" context={{ hint: 'One' }} />);
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: EMBED_READY_MESSAGE }, source: window }));
    });
    expect(win.postMessage).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: EMBED_READY_MESSAGE }, source: win as unknown as Window }),
      );
    });
    expect(win.postMessage).toHaveBeenCalledWith(
      { type: EMBED_CONTEXT_MESSAGE, context: { hint: 'One' } },
      'https://docs.acme.com',
    );
  });

  it('closes when the frame reports Escape', async () => {
    const user = userEvent.setup();
    render(<DocsAssistant siteUrl="https://docs.acme.com" />);
    const button = screen.getByRole('button', { name: 'Ask AI' });
    await user.click(button);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: EMBED_CLOSE_MESSAGE }, source: win as unknown as Window }),
      );
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores a color that is not a hex color', () => {
    render(<DocsAssistant siteUrl="https://docs.acme.com" color="red;position:absolute" />);
    expect(screen.getByRole('button', { name: 'Ask AI' }).style.background).toContain('rgb(24, 24, 27)');
  });
});

describe('EmbeddedAssistant', () => {
  const sse = (...events: object[]) =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));

  it('tells the page that holds it when it is ready, not when it stands alone', () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: post } as never);
    render(<EmbeddedAssistant endpoint="/api/ask-e0" />);
    expect(post).toHaveBeenCalledWith({ type: EMBED_READY_MESSAGE }, '*');
    parent.mockRestore();
    post.mockClear();
    render(<EmbeddedAssistant endpoint="/api/ask-e0b" />);
    expect(post).not.toHaveBeenCalled();
  });

  it('passes Escape on to the page that holds it', async () => {
    const post = vi.fn();
    const parent = vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: post } as never);
    render(<EmbeddedAssistant endpoint="/api/ask-e0c" />);
    post.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(post).toHaveBeenCalledWith({ type: EMBED_CLOSE_MESSAGE }, '*');
    parent.mockRestore();
  });

  it('shows the assistant filling its frame, with a link to the docs', () => {
    render(<EmbeddedAssistant name="Acme" endpoint="/api/ask-e1" />);
    expect(screen.getByRole('heading', { name: 'Ask the Acme docs' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ask a question')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open the docs/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('sends the context it was given with the question, and takes new context only from its host page', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return sse({ type: 'token', text: 'Done.' }, { type: 'done', citations: [] });
      }),
    );
    try {
      const user = userEvent.setup();
      render(<EmbeddedAssistant endpoint="/api/ask-e2" context={{ hint: 'First' }} />);
      const box = screen.getByLabelText('Ask a question');
      await user.type(box, 'one{Enter}');
      await screen.findByText('Done.');

      // A message from some other window is ignored...
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: EMBED_CONTEXT_MESSAGE, context: { hint: 'Forged' } },
            source: window,
          }),
        );
      });
      // ...one from the host page is taken.
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: EMBED_CONTEXT_MESSAGE, context: { hint: 'Second', path: '/guides/billing' } },
            source: window.parent,
          }),
        );
      });
      await user.type(box, 'two{Enter}');
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[0]).toMatchObject({ context: { hint: 'First' } });
      expect(bodies[1]).toMatchObject({ context: { hint: 'Second', path: '/guides/billing' } });
    } finally {
      vi.unstubAllGlobals();
      sessionStorage.clear();
    }
  });

  it('opens a source in a new tab instead of navigating the frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(
          {
            type: 'sources',
            items: [{ n: 1, title: 'Billing', path: '/b', anchor: '', url: '/b', headingPath: [] }],
          },
          { type: 'token', text: 'See [1].' },
          { type: 'done', citations: [1] },
        ),
      ),
    );
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const user = userEvent.setup();
      render(<EmbeddedAssistant endpoint="/api/ask-e3" />);
      await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
      await user.click(await screen.findByRole('link', { name: 'Source 1: Billing' }));
      expect(open).toHaveBeenCalledWith(
        `${window.location.origin}/b`,
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      open.mockRestore();
      vi.unstubAllGlobals();
      sessionStorage.clear();
    }
  });
});

describe('ask store context', () => {
  it('is sent with each question once set, and dropped when cleared', async () => {
    const bodies: unknown[] = [];
    const store = createAskStore({
      storage: null,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('data: {"type":"done","citations":[]}\n\n');
      },
    });
    store.setContext({ hint: 'Billing' });
    await store.ask('one');
    store.setContext(undefined);
    await store.ask('two');
    store.setContext({});
    await store.ask('three');
    expect(bodies[0]).toMatchObject({ context: { hint: 'Billing' } });
    expect(bodies[1]).not.toHaveProperty('context');
    expect(bodies[2]).not.toHaveProperty('context');
  });
});
