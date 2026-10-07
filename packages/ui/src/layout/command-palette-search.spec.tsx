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
