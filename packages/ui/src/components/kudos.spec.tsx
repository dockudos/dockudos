import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Kudos } from './kudos.tsx';
import { Logo, Wordmark } from './logo.tsx';

const ID = '11111111-1111-1111-1111-111111111111';

function mockFetch(handler: (body: Record<string, unknown>) => { ok: boolean; json?: unknown }) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const r = handler(JSON.parse(init.body as string));
    return { ok: r.ok, status: r.ok ? 201 : 500, json: async () => r.json ?? { id: ID } };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Kudos', () => {
  it('asks the question with two toggle buttons', () => {
    render(<Kudos path="/guide" />);
    expect(screen.getByRole('heading', { name: 'Was this page helpful?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('sends the vote, then offers an optional comment', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch(() => ({ ok: true }));
    render(<Kudos path="/guide" endpoint="/fb" />);
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(fetch).toHaveBeenCalledWith('/fb', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ path: '/guide', vote: 'down' });
    expect(await screen.findByLabelText(/What was missing or wrong/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
  });

  it('sends the comment with the vote id and says thanks', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch(() => ({ ok: true }));
    render(<Kudos path="/guide" />);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    const box = await screen.findByLabelText(/Glad it helped/);
    const send = screen.getByRole('button', { name: 'Send comment' });
    expect(send).toBeDisabled();
    await user.type(box, '  Great page  ');
    await user.click(send);
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ path: '/guide', id: ID, comment: 'Great page' });
    expect(await screen.findByRole('heading', { name: 'Thanks for your feedback' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });

  it('lets the visitor skip the comment', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch(() => ({ ok: true }));
    render(<Kudos path="/guide" />);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(await screen.findByRole('button', { name: 'No thanks' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Thanks for your feedback' })).toBeInTheDocument();
  });

  it('remembers the vote for that page only', async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: true }));
    const { unmount } = render(<Kudos path="/guide" />);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    unmount();
    render(<Kudos path="/guide" />);
    expect(await screen.findByRole('heading', { name: 'Thanks for your feedback' })).toBeInTheDocument();
    render(<Kudos path="/other" />);
    expect(screen.getAllByRole('button', { name: 'Yes' })).toHaveLength(1);
  });

  it('reports a failed vote, lets the visitor retry, and does not remember it', async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: false }));
    render(<Kudos path="/guide" />);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/Could not send your vote/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled();
    expect(localStorage.getItem('dockudos-kudos')).toBeNull();
  });

  it('keeps the comment text when sending it fails', async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockFetch(() => ({ ok: ++calls === 1 }));
    render(<Kudos path="/guide" />);
    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.type(await screen.findByRole('textbox'), 'Step 2 is wrong');
    await user.click(screen.getByRole('button', { name: 'Send comment' }));
    expect(await screen.findByText(/Could not send your comment/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Step 2 is wrong');
  });

  it('works from the keyboard and survives blocked storage', async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: true }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<Kudos path="/guide" />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    vi.restoreAllMocks();
  });

  it('uses a custom prompt', () => {
    render(<Kudos path="/x" prompt="Did this help?" />);
    expect(screen.getByRole('heading', { name: 'Did this help?' })).toBeInTheDocument();
  });
});

describe('Logo', () => {
  it('shows doc and kudos as two parts, the second in the brand color', () => {
    render(<Wordmark />);
    expect(screen.getByText('doc')).not.toHaveStyle({ color: 'var(--primary)' });
    expect(screen.getByText('kudos')).toHaveStyle({ color: 'var(--primary)' });
  });

  it('reads as a single name to screen readers and hides the mark', () => {
    const { container } = render(<Logo />);
    expect(container).toHaveTextContent('dockudos');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('can drop the mark', () => {
    const { container } = render(<Logo showMark={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
