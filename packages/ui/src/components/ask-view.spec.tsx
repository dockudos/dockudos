import type { AskEvent } from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAskStore } from '../lib/ask-store.ts';
import { DocsProvider } from '../provider.tsx';
import { AnswerText } from './answer.tsx';
import { AskView } from './ask-view.tsx';

const source = {
  n: 1,
  title: 'Authentication',
  path: '/auth',
  anchor: 'api-keys',
  url: '/auth#api-keys',
  headingPath: ['API keys'],
};
const second = { ...source, n: 2, title: 'Billing', path: '/b', anchor: '', url: '/b', headingPath: [] };

describe('AnswerText', () => {
  const view = (text: string, sources = [source, second]) =>
    render(<AnswerText text={text} sources={sources} />).container;

  it('renders paragraphs, lists, code and bold as elements', () => {
    const c = view(
      'First **bold** and `code`.\n\nSecond paragraph.\n\n- one\n- two\n\n1. a\n2. b\n\n```js\nconst x = [1];\n```\n',
    );
    expect(c.querySelectorAll('p')).toHaveLength(2);
    expect(c.querySelector('strong')?.textContent).toBe('bold');
    expect(c.querySelector('p code')?.textContent).toBe('code');
    expect(c.querySelectorAll('ul li')).toHaveLength(2);
    expect(c.querySelectorAll('ol li')).toHaveLength(2);
    expect(c.querySelector('pre code')?.textContent).toBe('const x = [1];');
  });

  it('turns [n] into a link to the source, labelled for screen readers', () => {
    view('Rotate keys [1] and pay [2].');
    const one = screen.getByRole('link', { name: 'Source 1: Authentication, API keys' });
    expect(one).toHaveAttribute('href', '/auth#api-keys');
    expect(one).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Source 2: Billing' })).toHaveAttribute('href', '/b');
  });

  it('leaves numbers that are not sources as text, and code untouched', () => {
    const c = view('See [9] and `a[1]`.');
    expect(screen.queryByRole('link')).toBeNull();
    expect(c.textContent).toBe('See [9] and a[1].');
  });

  it('never makes HTML, images or links of what the model writes', () => {
    const c = view(
      'Hello <img src=x onerror="alert(1)"> <script>alert(2)</script> [click](https://evil.example/x) ![p](https://evil.example/p.png) https://evil.example',
    );
    expect(c.querySelector('img, script, a')).toBeNull();
    expect(c.textContent).toContain('<script>alert(2)</script>');
    expect(c.textContent).toContain('[click](https://evil.example/x)');
  });

  it('shows a code block that is still being written', () => {
    const c = view('Run:\n\n```bash\nnpm install');
    expect(c.querySelector('pre code')?.textContent).toBe('npm install');
  });

  it('calls onNavigate for a plain click on a citation', async () => {
    const onNavigate = vi.fn();
    render(<AnswerText text="x [1]" sources={[source]} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('link'));
    expect(onNavigate).toHaveBeenCalledWith('/auth#api-keys');
  });
});

const sse = (...events: AskEvent[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));

function setup(fetch: ReturnType<typeof vi.fn>, props: Parameters<typeof AskView>[0] = {}) {
  const user = userEvent.setup();
  const navigate = vi.fn();
  const store = createAskStore({ fetch: fetch as never, storage: null });
  render(
    <DocsProvider navigate={navigate}>
      <AskView store={store} {...props} />
    </DocsProvider>,
  );
  return { user, navigate, store };
}

const good = () =>
  sse(
    { type: 'sources', items: [source] },
    { type: 'token', text: 'Rotate a key every ninety days [1].' },
    { type: 'done', citations: [1] },
  );

describe('AskView', () => {
  it('asks with Enter, streams the answer with links and lists the sources', async () => {
    const fetch = vi.fn(async () => good());
    const { user, navigate } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'How do I rotate?{Enter}');

    await screen.findByText(/Rotate a key every ninety days/);
    const log = screen.getByRole('log', { name: 'Conversation with the assistant' });
    expect(within(log).getByText('How do I rotate?')).toBeInTheDocument();
    const sources = within(log).getByText('Sources').parentElement as HTMLElement;
    const link = within(sources).getByRole('link', { name: 'Authentication › API keys' });
    expect(link).toHaveAttribute('href', '/auth#api-keys');
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/auth#api-keys');
    expect(screen.getByLabelText('Ask a question')).toHaveValue('');
  });

  it('adds a line with Shift+Enter instead of sending', async () => {
    const fetch = vi.fn(async () => good());
    const { user } = setup(fetch);
    const box = screen.getByLabelText('Ask a question');
    await user.type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect(box).toHaveValue('one\ntwo');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('will not send an empty question, and limits the length', async () => {
    const fetch = vi.fn(async () => good());
    const { user } = setup(fetch, { maxQuestionLength: 10 });
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
    const box = screen.getByLabelText('Ask a question');
    await user.type(box, '12345678901234');
    expect(box).toHaveValue('1234567890');
  });

  it('shows a stop button while answering, then the send button again', async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    const { user } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    expect(await screen.findByRole('button', { name: 'Stop answering' })).toBeInTheDocument();
    expect(screen.getByText('Looking through the docs…')).toBeInTheDocument();
    finish(good());
    expect(await screen.findByRole('button', { name: 'Send question' })).toBeInTheDocument();
  });

  it('marks the answer busy while it streams so screen readers wait for it', async () => {
    let finish: (r: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    const { user } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    await waitFor(() =>
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    finish(good());
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('shows related pages for a refusal, and a warning for an uncited answer', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: 'token', text: "I couldn't find anything about that." },
          { type: 'done', citations: [], refused: 'no-context', related: [second] },
        ),
      )
      .mockResolvedValueOnce(
        sse(
          { type: 'token', text: 'Probably yes.' },
          { type: 'done', citations: [], flagged: 'uncited', related: [source] },
        ),
      );
    const { user } = setup(fetch);
    const box = screen.getByLabelText('Ask a question');
    await user.type(box, 'a{Enter}');
    expect(await screen.findByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/b');
    expect(screen.getByText('Pages that may help')).toBeInTheDocument();
    await user.type(box, 'b{Enter}');
    expect(await screen.findByText(/does not point to a source/)).toBeInTheDocument();
  });

  it('announces errors', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"Too many questions."}', { status: 429 }));
    const { user } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions.');
  });

  it('starts a new conversation', async () => {
    const fetch = vi.fn(async () => good());
    const { user, store } = setup(fetch);
    await user.type(screen.getByLabelText('Ask a question'), 'q{Enter}');
    await screen.findByText(/Rotate a key/);
    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(store.getState().turns).toEqual([]);
    expect(screen.getByText(/Ask a question about the documentation/)).toBeInTheDocument();
  });

  it('asks the initial question once', async () => {
    const fetch = vi.fn(async () => good());
    const { rerender } = (() => {
      const store = createAskStore({ fetch: fetch as never, storage: null });
      const r = render(
        <DocsProvider>
          <AskView store={store} initialQuestion="How?" />
        </DocsProvider>,
      );
      return {
        rerender: () =>
          r.rerender(
            <DocsProvider>
              <AskView store={store} initialQuestion="How?" />
            </DocsProvider>,
          ),
      };
    })();
    await screen.findByText(/Rotate a key/);
    rerender();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
