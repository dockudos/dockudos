import { EMBED_CONTEXT_MESSAGE, type AskSource } from '@dockudos/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { createAskStore } from '../lib/ask-store.ts';
import { DocsProvider } from '../provider.tsx';
import { AnswerText } from './answer.tsx';
import { AskView } from './ask-view.tsx';
import { DocsAssistant } from './docs-assistant.tsx';
import { EmbeddedAssistant } from './embedded-assistant.tsx';

const source: AskSource = {
  n: 1,
  title: 'Auth',
  path: '/auth',
  anchor: '',
  url: '/auth',
  headingPath: [],
};

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));

// jsdom cannot navigate; record whether the page's own handler cancelled each click, and cancel it for jsdom.
const clicks: boolean[] = [];
const record = (e: Event) => {
  clicks.push(e.defaultPrevented);
  e.preventDefault();
};
beforeEach(() => {
  clicks.length = 0;
  document.addEventListener('click', record);
});
afterEach(() => document.removeEventListener('click', record));

describe('AnswerText branches', () => {
  it('starts with a citation, keeps modifier clicks native, and works without onNavigate', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <AnswerText text="[1] first" sources={[source]} onNavigate={onNavigate} />,
    );
    const link = screen.getByRole('link');
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/auth');

    clicks.length = 0;
    rerender(<AnswerText text="[1] first" sources={[source]} />);
    fireEvent.click(screen.getByRole('link'));
    expect(clicks).toEqual([false]);
  });

  it('keeps line breaks inside a paragraph', () => {
    const { container } = render(
      <AnswerText text={'one\ntwo\nthree'} sources={[]} />,
    );
    expect(container.querySelectorAll('p br')).toHaveLength(2);
  });
});

describe('AskView branches', () => {
  const setup = (fetch: ReturnType<typeof vi.fn>) => {
    const navigate = vi.fn();
    const store = createAskStore({ fetch: fetch as never, storage: null });
    render(
      <DocsProvider navigate={navigate}>
        <AskView store={store} />
      </DocsProvider>,
    );
    return { store, navigate, user: userEvent.setup() };
  };

  it('renders on the server with no conversation', () => {
    const store = createAskStore({ fetch: vi.fn() as never, storage: null });
    const html = renderToString(<AskView store={store} />);
    expect(html).toContain('Ask a question about the documentation');
  });

  it('keeps a modified click on a source for the browser, and skips unknown citations', async () => {
    const fetch = vi.fn(async () =>
      sse(
        { type: 'sources', items: [source] },
        { type: 'token', text: 'Reply [1].' },
        { type: 'done', citations: [1, 7] },
      ),
    );
    const { user, navigate } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    await screen.findByText(/Reply/);
    const links = screen.getAllByRole('link', { name: /Auth/ });
    const last = links[links.length - 1] as HTMLElement;
    fireEvent.click(last, { ctrlKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(last);
    expect(navigate).toHaveBeenCalledWith('/auth');
  });

  it('does not send an empty question or a second one while answering', async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    const { user } = setup(fetch);
    const box = screen.getByLabelText('Ask a question');
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(fetch).not.toHaveBeenCalled();

    await user.type(box, 'one{Enter}');
    await user.type(box, 'two{Enter}');
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(sse({ type: 'done', citations: [] }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send question' })).toBeInTheDocument(),
    );
  });

  it('says so when answering was stopped before any text', async () => {
    const fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const { user } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Stop answering' }));
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(screen.queryByText('Looking through the docs…')).toBeNull();
  });
});

describe('DocsAssistant branches', () => {
  it('sends an empty context, sits on the left, and ignores other keys', async () => {
    const user = userEvent.setup();
    render(<DocsAssistant siteUrl="https://docs.acme.com" position="left" />);
    const button = screen.getByRole('button', { name: 'Ask AI' });
    await user.click(button);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post } });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'dockudos:ready' },
        source: frame.contentWindow,
      }),
    );
    await user.keyboard('a');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.style.left).toBe('20px');
    expect(post.mock.calls.every(([m]) => m.type === EMBED_CONTEXT_MESSAGE)).toBe(true);
  });
});

describe('EmbeddedAssistant branches', () => {
  it('drops messages from other windows, bad messages, and clears an empty context', () => {
    const host = { postMessage: vi.fn() };
    const parent = vi.spyOn(window, 'parent', 'get').mockReturnValue(host as never);
    render(<EmbeddedAssistant endpoint="/api/ask-more" />);
    const send = (data: unknown, from: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, source: from as Window }));
      });
    send({ type: EMBED_CONTEXT_MESSAGE, context: { hint: 'x' } }, window);
    send('nonsense', host);
    send({ type: EMBED_CONTEXT_MESSAGE, context: { hint: 'y' } }, host);
    send({ type: EMBED_CONTEXT_MESSAGE, context: {} }, host);
    expect(screen.getByLabelText('Ask a question')).toBeInTheDocument();
    parent.mockRestore();
  });
});
