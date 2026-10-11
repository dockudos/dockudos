import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsProvider } from '../provider.tsx';
import {
  AssistantButton,
  AssistantPanel,
  openAssistant,
} from './assistant-panel.tsx';
import { TutorialHeader } from './tutorial-header.tsx';

const source = {
  n: 1,
  title: 'Auth',
  path: '/auth',
  anchor: '',
  url: '/auth',
  headingPath: [],
};

describe('AssistantPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('toggles with Ctrl+I, and a button opens it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AssistantButton />
        <AssistantPanel endpoint="/api/ask-panel-1" />
      </>,
    );
    await user.keyboard('{Control>}i{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Control>}i{/Control}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Ask the docs' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('asks a question it was opened with, forgets it on close, and closes when a source is followed', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response(
          [
            { type: 'sources', items: [source] },
            { type: 'token', text: 'See [1].' },
            { type: 'done', citations: [1] },
          ]
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join(''),
        );
      }),
    );
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(
      <DocsProvider navigate={navigate}>
        <AssistantPanel endpoint="/api/ask-panel-2" />
      </DocsProvider>,
    );
    act(() => openAssistant('How do I log in?'));
    await screen.findByText(/See/);
    expect(bodies[0]).toContain('How do I log in?');
    await user.click(
      screen.getAllByRole('link', { name: /Auth/ }).at(-1) as HTMLElement,
    );
    expect(navigate).toHaveBeenCalledWith('/auth');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => openAssistant());
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('TutorialHeader', () => {
  const steps = [
    { path: '/one', title: 'One' },
    { path: '/two', title: 'Two' },
    { path: '/three', title: 'Three' },
  ];
  beforeEach(() => localStorage.clear());

  it('ticks the steps opened earlier and counts them', async () => {
    localStorage.setItem('dockudos-tutorial:T', JSON.stringify(['/one', 7]));
    render(<TutorialHeader title="T" step={2} steps={steps} />);
    expect(await screen.findByText(/1 finished earlier/)).toBeInTheDocument();
    expect(screen.getByText(/One \(visited\)/)).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem('dockudos-tutorial:T') as string),
    ).toEqual(['/one', '/two']);
  });

  it('starts over when what is stored is not a list, and does nothing for a step that does not exist', () => {
    localStorage.setItem('dockudos-tutorial:T', '{"not":"a list"}');
    const { unmount } = render(
      <TutorialHeader title="T" step={1} steps={steps} />,
    );
    expect(
      JSON.parse(localStorage.getItem('dockudos-tutorial:T') as string),
    ).toEqual(['/one']);
    unmount();
    localStorage.clear();
    render(<TutorialHeader title="T" step={9} steps={steps} />);
    expect(localStorage.getItem('dockudos-tutorial:T')).toBeNull();
  });

  it('works with storage that cannot be read or written', () => {
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const set = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    render(<TutorialHeader title="T" step={1} steps={steps} />);
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});
