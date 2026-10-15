import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/components/shell';
import {
  Bars,
  ErrorBox,
  Kpi,
  StatusBadge,
  useApi,
  when,
} from '../src/components/ui';
import { ApiError } from '../src/lib/api';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const reply = (status: number, body: unknown) =>
  ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  }) as Response;

beforeEach(() => {
  pathname = '/';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ErrorBox', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<ErrorBox error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers sign-in on a 401', () => {
    render(<ErrorBox error={new ApiError(401, 'unauthorized', 'x')} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('warn');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth/login?returnTo=/',
    );
  });

  it('shows the message of any other error', () => {
    render(
      <ErrorBox
        error={new ApiError(500, 'internal', 'Something went wrong.')}
      />,
    );
    expect(screen.getByRole('alert')).toHaveClass('error');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong.',
    );
  });
});

describe('StatusBadge', () => {
  it.each([
    ['succeeded', 'ok'],
    ['opened', 'ok'],
    ['failed', 'bad'],
    ['running', 'warn'],
    ['flagged', 'warn'],
    ['queued', ''],
    ['no-changes', ''],
  ])('%s is styled %j', (status, cls) => {
    render(<StatusBadge status={status} />);
    const el = screen.getByText(status);
    expect(el).toHaveClass('badge');
    if (cls) expect(el).toHaveClass(cls);
    else expect(el.className.trim()).toBe('badge');
  });
});

describe('Kpi and Bars', () => {
  it('shows a value with its label', () => {
    render(<Kpi label="Page views" value={1234} />);
    expect(screen.getByText('1234')).toHaveClass('value');
    expect(screen.getByText('Page views')).toHaveClass('label');
  });

  it('scales bars to the tallest, never below a visible sliver', () => {
    render(<Bars label="Views per day" values={[0, 5, 10]} />);
    const chart = screen.getByRole('img', { name: 'Views per day' });
    const heights = [...chart.children].map(
      (c) => (c as HTMLElement).style.height,
    );
    expect(heights).toEqual(['2%', '50%', '100%']);
    expect(chart.children[1]).toHaveAttribute('title', '5');
  });

  it('copes with no data and all zeros', () => {
    const { rerender } = render(<Bars label="empty" values={[]} />);
    expect(screen.getByRole('img', { name: 'empty' }).children).toHaveLength(0);
    rerender(<Bars label="zeros" values={[0, 0]} />);
    expect(
      [...screen.getByRole('img', { name: 'zeros' }).children].map(
        (c) => (c as HTMLElement).style.height,
      ),
    ).toEqual(['2%', '2%']);
  });
});

describe('when', () => {
  it('formats a date and tolerates a missing one', () => {
    expect(when(undefined)).toBe('');
    expect(when('')).toBe('');
    expect(when('2026-03-01T12:00:00Z')).toBe(
      new Date('2026-03-01T12:00:00Z').toLocaleString(),
    );
  });
});

function Probe({ path }: { path: string | null }) {
  const { data, error, loading, reload } = useApi<{ n: number }>(path);
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : 'idle'}</span>
      <span data-testid="data">{data ? data.n : '-'}</span>
      <span data-testid="error">
        {error ? `${error.status}:${error.message}` : '-'}
      </span>
      <button onClick={() => void reload()}>reload</button>
    </div>
  );
}

describe('useApi', () => {
  it('loads once, then again on demand', async () => {
    let n = 0;
    const f = vi.fn(async () => reply(200, { n: ++n }));
    vi.stubGlobal('fetch', f);
    render(<Probe path="/api/v1/x" />);
    expect(screen.getByTestId('state')).toHaveTextContent('loading');
    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('1'),
    );
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    await userEvent.click(screen.getByRole('button', { name: 'reload' }));
    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('2'),
    );
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('reports an error with its status, and recovers on reload', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fail
          ? reply(401, {
              error: { code: 'unauthorized', message: 'Sign in to continue.' },
            })
          : reply(200, { n: 7 }),
      ),
    );
    render(<Probe path="/api/v1/x" />);
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(
        '401:Sign in to continue.',
      ),
    );
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'reload' }));
    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('7'),
    );
    expect(screen.getByTestId('error')).toHaveTextContent('-');
  });

  it('does nothing without a path', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<Probe path={null} />);
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    await userEvent.click(screen.getByRole('button', { name: 'reload' }));
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches again when the path changes', async () => {
    const f = vi.fn(async (p: string) =>
      reply(200, { n: p.endsWith('b') ? 2 : 1 }),
    );
    vi.stubGlobal('fetch', f);
    const { rerender } = render(<Probe path="/a" />);
    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('1'),
    );
    rerender(<Probe path="/b" />);
    await waitFor(() =>
      expect(screen.getByTestId('data')).toHaveTextContent('2'),
    );
  });
});

describe('Shell', () => {
  it('shows the signed-in person and a sign-out form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply(200, { user: { email: 'ada@x.test', name: 'Ada' } }),
      ),
    );
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    const out = screen.getByRole('button', { name: 'Sign out' });
    expect(out.closest('form')).toHaveAttribute('action', '/auth/logout');
    expect(out.closest('form')).toHaveAttribute('method', 'post');
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dockudos' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('falls back to the email when there is no name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { user: { email: 'ada@x.test' } })),
    );
    render(<Shell>x</Shell>);
    expect(await screen.findByText('ada@x.test')).toBeInTheDocument();
  });

  it.each([
    ['no user in the answer', () => reply(200, {})],
    [
      'an error answer',
      () => reply(401, { error: { code: 'unauthorized', message: 'no' } }),
    ],
    ['a network failure', () => Promise.reject(new Error('offline'))],
  ])('offers sign-in for %s', async (_n, answer) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer()),
    );
    render(<Shell>x</Shell>);
    expect(
      await screen.findByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/auth/login?returnTo=/');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('shows neither link while it is still finding out who you are', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<Shell>x</Shell>);
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('renders the preview frame bare, with no header', () => {
    pathname = '/preview-frame';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const { container } = render(
      <Shell>
        <p>frame</p>
      </Shell>,
    );
    expect(container.querySelector('header')).toBeNull();
    expect(screen.getByText('frame')).toBeInTheDocument();
  });
});
