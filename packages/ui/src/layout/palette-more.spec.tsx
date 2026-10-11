import type { SearchBackend, SearchHit } from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsProvider } from '../provider.tsx';
import {
  CommandPalette,
  type PaletteEntry,
  scoreEntry,
} from './command-palette.tsx';

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: 'c1',
  path: '/guides/auth',
  title: 'Authentication',
  headingPath: [],
  anchor: '',
  url: '/guides/auth',
  snippet: { text: 'abc', ranges: [[0, 3]] },
  score: 1,
  ...over,
});

const entries: PaletteEntry[] = [
  {
    title: 'Authentication',
    path: '/guides/auth',
    group: 'Guides',
    icon: 'rocket',
    description: 'Log in',
  },
  { title: 'Plain', path: '/plain' },
];

let n = 0;
function setup({
  search = async () => [],
  ai = false,
  navigation,
  respond,
}: {
  search?: SearchBackend['search'];
  ai?: boolean;
  navigation?: boolean;
  respond?: (url: string) => Response;
} = {}) {
  const id = n++;
  const endpoint = `/api/ask-pm-${id}`;
  const navigateEndpoint = `/api/navigate-pm-${id}`;
  const fetchMock = vi.fn(async (url: string) => {
    if (respond) return respond(url);
    return new Response(
      [
        { type: 'token', text: 'An answer.' },
        { type: 'done', citations: [] },
      ]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(''),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <DocsProvider navigate={navigate} searchBackend={{ id: 't', search }}>
      <CommandPalette
        entries={entries}
        search={{ backend: 'builtin' }}
        ai={ai ? { endpoint, navigateEndpoint, navigation } : undefined}
      />
    </DocsProvider>,
  );
  return { user, navigate, fetchMock, navigateEndpoint };
}
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.keyboard('{Control>}k{/Control}');
  return screen.findByRole('combobox');
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('scoreEntry', () => {
  it('matches everything for no words, and nothing that has no group or description to help', () => {
    const entry: PaletteEntry = { title: 'Alpha', path: '/a' };
    expect(scoreEntry(entry, '')).toBe(1);
    expect(scoreEntry(entry, 'zzz')).toBe(0);
    expect(scoreEntry(entry, 'alpha')).toBe(100);
  });
});

describe('palette rows', () => {
  it('shows a page’s icon, description and section, and marks the matched words of a hit', async () => {
    const { user } = setup({
      search: async () => [
        hit({
          snippet: {
            text: 'abcdefgh',
            ranges: [
              [2, 4],
              [3, 5],
              [6, 7],
            ],
          },
        }),
        hit({
          id: 'c2',
          url: '/guides/auth#x',
          anchor: 'x',
          snippet: { text: 'abc', ranges: [[0, 3]] },
        }),
      ],
    });
    await open(user);
    expect(screen.getByText('Log in')).toBeInTheDocument();
    expect(screen.getByText('Guides')).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'abc');
    const options = await screen.findAllByRole('option');
    const first = options.find((o) =>
      o.textContent?.includes('abcdefgh'),
    ) as HTMLElement;
    expect(
      within(first)
        .getAllByText(/^(cd|g)$/)
        .map((m) => m.tagName),
    ).toEqual(['MARK', 'MARK']);
  });

  it('does nothing on Enter when nothing matches', async () => {
    const { user, navigate } = setup();
    const box = await open(user);
    await user.type(box, 'qqqq{Enter}');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('palette assistant and navigation', () => {
  it('goes back from the conversation to search with the Search button', async () => {
    const { user } = setup({ ai: true });
    await user.type(await open(user), 'how do I log in?{Enter}');
    expect(await screen.findByText('An answer.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('does nothing for Tab or Ctrl+Enter with nothing typed', async () => {
    const { user, fetchMock } = setup({ ai: true });
    await open(user);
    await user.keyboard('{Tab}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not take you anywhere when navigation is off', async () => {
    const { user, fetchMock } = setup({ ai: true, navigation: false });
    await user.type(await open(user), 'billing email');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a single choice when it is not sure and has no other places to offer', async () => {
    const { user } = setup({
      ai: true,
      respond: () =>
        new Response(
          JSON.stringify({
            path: '/plain',
            anchor: '',
            title: 'Plain',
            headingPath: [],
            url: '/plain',
            reason: 'Maybe.',
            confidence: 'low',
            ranked: 'model',
          }),
        ),
    });
    await user.type(await open(user), 'something odd here');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Best guess');
  });
});
