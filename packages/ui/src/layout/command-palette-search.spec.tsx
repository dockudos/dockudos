import {
  type SearchBackend,
  type SearchHit,
  buildContentIndex,
} from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsProvider } from '../provider.tsx';
import { CommandPalette, type PaletteEntry } from './command-palette.tsx';

const entries: PaletteEntry[] = [
  { title: 'Authentication', path: '/guides/auth', group: 'Guides' },
  { title: 'Empty page', path: '/empty', group: 'Guides' },
];

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: 'c1',
  path: '/guides/auth',
  title: 'Authentication',
  headingPath: ['API keys'],
  anchor: 'api-keys',
  url: '/guides/auth#api-keys',
  snippet: { text: 'Rotate a key every ninety days.', ranges: [[0, 6]] },
  score: 1,
  ...over,
});

function setup(
  backend: SearchBackend | undefined,
  navigate = vi.fn(),
  search: Parameters<typeof CommandPalette>[0]['search'] = {
    backend: 'builtin',
  },
) {
  const user = userEvent.setup();
  render(
    <DocsProvider navigate={navigate} searchBackend={backend}>
      <CommandPalette entries={entries} search={search} />
    </DocsProvider>,
  );
  return { user, navigate };
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.keyboard('{Control>}k{/Control}');
  return screen.findByRole('combobox', { name: 'Search pages' });
};

describe('CommandPalette full-text search', () => {
  it('shows the section, its heading path and the matched words', async () => {
    const search = vi.fn(async () => [hit()]);
    const { user } = setup({ id: 't', search });
    await user.type(await open(user), 'rotate');

    const option = await screen.findByRole('option', { name: /API keys/ });
    expect(within(option).getByText('Authentication')).toBeInTheDocument();
    expect(option).toHaveTextContent('Authentication › API keys');
    expect(within(option).getByText('Rotate').tagName).toBe('MARK');
    expect(search).toHaveBeenLastCalledWith('rotate', {
      limit: 10,
      maxPerPage: 2,
    });
  });

  it('opens the section, not just the page, with Enter and with a click', async () => {
    const search = vi.fn(async () => [
      hit(),
      hit({
        id: 'c2',
        anchor: '',
        headingPath: [],
        url: '/guides/auth',
        snippet: { text: 'Intro', ranges: [] },
      }),
    ]);
    const { user, navigate } = setup({ id: 't', search });
    const box = await open(user);
    await user.type(box, 'key');
    await screen.findAllByRole('option');
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('/guides/auth#api-keys');

    await open(user);
    await user.type(await screen.findByRole('combobox'), 'key');
    const options = await screen.findAllByRole('option');
    await user.click(options[1] as HTMLElement);
    expect(navigate).toHaveBeenLastCalledWith('/guides/auth');
  });

  it('moves with the arrow keys and tells the combobox which option is active', async () => {
    const search = vi.fn(async () => [
      hit(),
      hit({ id: 'c2', url: '/b', path: '/b', headingPath: [], anchor: '' }),
    ]);
    const { user, navigate } = setup({ id: 't', search });
    const box = await open(user);
    await user.type(box, 'key');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[0]?.id);
    await user.keyboard('{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]?.id);
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('/b');
  });

  it('announces the number of results', async () => {
    const search = vi.fn(async () => [hit(), hit({ id: 'c2' })]);
    const { user } = setup({ id: 't', search });
    await user.type(await open(user), 'key');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 results'),
    );
  });

  it('also lists pages whose title matches but that have no text to find', async () => {
    const search = vi.fn(async () => [hit()]);
    const { user } = setup({ id: 't', search });
    await user.type(await open(user), 'empty');
    expect(await screen.findByText('Empty page')).toBeInTheDocument();
  });

  it('says so when nothing is found', async () => {
    const { user } = setup({ id: 't', search: async () => [] });
    await user.type(await open(user), 'zzzz');
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
  });

  it('falls back to page titles when search fails, and says so', async () => {
    const { user } = setup({
      id: 't',
      search: async () => {
        throw new Error('offline');
      },
    });
    await user.type(await open(user), 'auth');
    expect(
      await screen.findByRole('option', { name: /Authentication/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('unavailable'),
    );
  });

  it('lists the pages before anything is typed', async () => {
    const search = vi.fn(async () => []);
    const { user } = setup({ id: 't', search });
    await open(user);
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(search).not.toHaveBeenCalled();
  });

  it('downloads the built-in index only when the first search runs', async () => {
    const { index } = buildContentIndex([
      {
        path: '/guides/auth',
        title: 'Authentication',
        body: '## API keys\n\nRotate a key every ninety days.',
      },
    ]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => index,
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { user, navigate } = setup(undefined, vi.fn(), {
        backend: 'builtin',
        endpoint: '/api/search',
      });
      const box = await open(user);
      expect(fetchMock).not.toHaveBeenCalled();
      await user.type(box, 'rotate');
      await screen.findByRole('option', { name: /API keys/ });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/search/index', undefined);
      await user.keyboard('{Enter}');
      expect(navigate).toHaveBeenCalledWith('/guides/auth#api-keys');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('CommandPalette assistant', () => {
  let n = 0;
  const askFetch = () =>
    vi.fn(async (_url: string, _init?: RequestInit) => {
      const events = [
        {
          type: 'sources',
          items: [
            {
              n: 1,
              title: 'Authentication',
              path: '/guides/auth',
              anchor: 'api-keys',
              url: '/guides/auth#api-keys',
              headingPath: ['API keys'],
            },
          ],
        },
        { type: 'token', text: 'Rotate a key every ninety days [1].' },
        { type: 'done', citations: [1] },
      ];
      return new Response(
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
      );
    });

  function withAi(
    search: SearchBackend['search'] = async () => [hit()],
    navigation: boolean | undefined = undefined,
    onNavigateCall?: (init?: RequestInit) => Response | Promise<Response>,
  ) {
    const endpoint = `/api/ask-${n}`;
    const navigateEndpoint = `/api/navigate-${n++}`;
    const askMock = askFetch();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url === navigateEndpoint && onNavigateCall
        ? onNavigateCall(init)
        : askMock(url, init),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate} searchBackend={{ id: 't', search }}>
        <CommandPalette
          entries={entries}
          search={{ backend: 'builtin' }}
          ai={{
            endpoint,
            navigateEndpoint,
            navigation,
            maxQuestionLength: 200,
          }}
        />
      </DocsProvider>,
    );
    return { user, navigate, fetchMock, endpoint, navigateEndpoint };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('offers nothing about AI before anything is typed, or when AI is off', async () => {
    const { user } = withAi();
    await open(user);
    expect(screen.queryByText(/Ask AI/)).toBeNull();
    expect(screen.queryByText(/Tab to ask AI/)).toBeInTheDocument(); // hint is part of the footer
  });

  it('orders the AI rows by what was typed: a question asks first, keywords keep search first', async () => {
    const { user } = withAi();
    const box = await open(user);
    const texts = () =>
      screen.getAllByRole('option').map((o) => o.textContent ?? '');

    await user.type(box, 'how do I rotate a key?');
    await screen.findAllByRole('option');
    expect(texts()[0]).toContain('Ask AI: “how do I rotate a key?”');
    expect(texts()[1]).toContain('Take me there');

    await user.clear(box);
    await user.type(box, 'rotate a key');
    await screen.findByRole('option', { name: /API keys/ });
    expect(texts()[0]).not.toMatch(/Ask AI|Take me there/);
    expect(texts().at(-2)).toContain('Ask AI: “rotate a key”');
    expect(texts().at(-1)).toContain('Take me there: “rotate a key”');
  });

  it('puts navigation first for a few words that match nothing', async () => {
    const { user } = withAi(async () => []);
    const box = await open(user);
    await user.type(box, 'update where invoices go');
    await screen.findAllByRole('option');
    const texts = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(texts[0]).toContain('Take me there');
    expect(texts[1]).toContain('Ask AI');
  });

  it('answers in the palette with Enter on the Ask row, with linked sources', async () => {
    const { user, navigate, fetchMock, endpoint } = withAi();
    const box = await open(user);
    await user.type(box, 'how do I rotate a key?{Enter}');
    expect(
      await screen.findByText(/Rotate a key every ninety days/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(endpoint);
    const link = await screen.findByRole('link', {
      name: 'Source 1: Authentication, API keys',
    });
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/guides/auth#api-keys');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Tab asks the assistant from search results, Esc goes back to search, a second Esc closes', async () => {
    const { user, fetchMock } = withAi();
    const box = await open(user);
    await user.type(box, 'rotate');
    await screen.findByRole('option', { name: /API keys/ });
    await user.keyboard('{Tab}');
    expect(
      await screen.findByText(/Rotate a key every ninety days/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('combobox')).toBeNull();

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Tab does nothing special when AI is off', async () => {
    const user = userEvent.setup();
    render(
      <DocsProvider searchBackend={{ id: 't', search: async () => [hit()] }}>
        <CommandPalette entries={entries} search={{ backend: 'builtin' }} />
      </DocsProvider>,
    );
    const box = await open(user);
    await user.type(box, 'rotate');
    expect(screen.queryByText(/Ask AI/)).toBeNull();
    expect(screen.queryByText(/Tab to ask AI/)).toBeNull();
  });
});

describe('CommandPalette "Take me there"', () => {
  let n = 100;
  const target = (over: object = {}) => ({
    path: '/guides/billing',
    anchor: 'change-the-billing-email',
    title: 'Billing',
    headingPath: ['Change the billing email'],
    url: '/guides/billing#change-the-billing-email',
    ...over,
  });
  const found = (over: object = {}) => ({
    ...target(),
    reason: 'This section explains how to change the billing email.',
    confidence: 'high',
    ranked: 'model',
    ...over,
  });
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  function setup(
    respond: (init?: RequestInit) => Response | Promise<Response>,
    navigation?: boolean,
  ) {
    const navigateEndpoint = `/api/navigate-${n++}`;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      respond(init),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <DocsProvider
        navigate={navigate}
        searchBackend={{ id: 't', search: async () => [] }}
      >
        <CommandPalette
          entries={entries}
          search={{ backend: 'builtin' }}
          ai={{ endpoint: '/api/ask', navigateEndpoint, navigation }}
        />
      </DocsProvider>,
    );
    return { user, navigate, fetchMock, navigateEndpoint };
  }
  afterEach(() => vi.unstubAllGlobals());

  const type = async (
    user: ReturnType<typeof userEvent.setup>,
    text: string,
  ) => {
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox'), text);
  };

  it('goes to the section and says why, when it is sure', async () => {
    const { user, navigate, fetchMock, navigateEndpoint } = setup(() =>
      reply(found()),
    );
    await type(user, 'change billing email');
    await screen.findByRole('option', { name: /Take me there/ });
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/guides/billing#change-the-billing-email',
      ),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(navigateEndpoint);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: 'change billing email',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const notice = await screen.findByText(
      /This section explains how to change the billing email/,
    );
    expect(notice.closest('[role="status"]')).toHaveTextContent(
      'Billing › Change the billing email.',
    );
    // The notice goes when asked.
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/This section explains/)).toBeNull();
  });

  it('Cmd or Ctrl + Enter takes you there from anywhere in the results', async () => {
    const { user, navigate } = setup(() => reply(found()));
    await type(user, 'billing');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });

  it('shows the choices instead of jumping when it is not sure, and each one works', async () => {
    const alt = target({
      path: '/guides/org',
      anchor: 'notifications',
      title: 'Organization settings',
      headingPath: ['Notifications'],
      url: '/guides/org#notifications',
    });
    const { user, navigate } = setup(() =>
      reply(
        found({
          confidence: 'low',
          reason: 'Two places fit.',
          alternatives: [alt],
        }),
      ),
    );
    await type(user, 'notification settings');
    await user.keyboard('{Control>}{Enter}{/Control}');

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Billing › Change the billing email'),
      expect.stringContaining('Organization settings › Notifications'),
    ]);
    expect(options[0]).toHaveTextContent('Best guess');
    expect(
      screen.getByText(/Not sure which you mean\. Two places fit\./),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(options[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/guides/org#notifications');
    // Only the best guess comes with a reason; the other places do not.
    expect(screen.queryByText(/Two places fit/)).toBeNull();
  });

  it('says so when nothing matches, and shows errors', async () => {
    const { user } = setup(() =>
      reply({ error: 'Nothing in the docs matches that.' }, 404),
    );
    await type(user, 'quantum llamas');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(
      (await screen.findAllByText('Nothing in the docs matches that.')).length,
    ).toBeGreaterThan(0);
  });

  it('shows the server’s message for an error', async () => {
    const { user } = setup(() =>
      reply({ error: 'Too many questions. Try again in 9 seconds.' }, 429),
    );
    await type(user, 'change billing email');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many questions. Try again in 9 seconds.',
    );
  });

  it('ignores an answer that arrives after the reader typed something else', async () => {
    let release: (r: Response) => void = () => undefined;
    const { user, navigate } = setup(
      () => new Promise<Response>((r) => (release = r)),
    );
    await type(user, 'change billing email');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(
      (await screen.findAllByText('Finding the best page…')).length,
    ).toBeGreaterThan(0);
    await user.type(screen.getByRole('combobox'), ' now');
    release(reply(found()));
    await new Promise((r) => setTimeout(r, 20));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryAllByText('Finding the best page…')).toHaveLength(0);
  });

  it('is off when ai.navigation is false', async () => {
    const { user } = setup(() => reply(found()), false);
    await type(user, 'change billing email');
    await screen.findAllByRole('option');
    expect(screen.queryByText(/Take me there/)).toBeNull();
    expect(screen.queryByText(/take me there/)).toBeNull();
  });
});
