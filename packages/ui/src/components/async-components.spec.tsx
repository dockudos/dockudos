import { render, screen, waitFor } from '@testing-library/react';
import { GithubInfo } from './github-info.tsx';
import { Mermaid } from './mermaid.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('mermaid');
  vi.resetModules();
});

describe('GithubInfo', () => {
  const json = (body: unknown, ok = true) =>
    vi.fn().mockResolvedValue({ ok, json: async () => body });

  it('shows the description, stars and forks as a safe external link', async () => {
    const fetch = json({
      description: 'The React framework',
      stargazers_count: 123456,
      forks_count: 2500,
    });
    vi.stubGlobal('fetch', fetch);
    render(await GithubInfo({ owner: 'vercel', repo: 'next.js' }));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://github.com/vercel/next.js');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('vercel/next.js');
    expect(link).toHaveTextContent('The React framework');
    expect(link).toHaveTextContent('123K');
    expect(link).toHaveTextContent('2.5K');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/vercel/next.js',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('sends a token when GITHUB_TOKEN is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'secret');
    const fetch = json({
      description: null,
      stargazers_count: 1,
      forks_count: 1,
    });
    vi.stubGlobal('fetch', fetch);
    await GithubInfo({ owner: 'a', repo: 'b' });
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe('Bearer secret');
    vi.unstubAllEnvs();
  });

  it.each([
    ['a rate-limit response', () => json({}, false)],
    [
      'a network failure',
      () => vi.fn().mockRejectedValue(new Error('offline')),
    ],
  ])(
    'still renders a working link, without numbers, on %s',
    async (_name, make) => {
      vi.stubGlobal('fetch', make());
      render(await GithubInfo({ owner: 'a', repo: 'b' }));
      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        'https://github.com/a/b',
      );
      expect(screen.queryByText(/stars/)).not.toBeInTheDocument();
    },
  );
});

describe('Mermaid', () => {
  it('shows the source first, then the rendered diagram', async () => {
    const initialize = vi.fn();
    const mermaidRender = vi
      .fn()
      .mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
    vi.doMock('mermaid', () => ({
      default: { initialize, render: mermaidRender },
    }));
    const { Mermaid: Fresh } = await import('./mermaid.tsx');
    render(<Fresh chart={'graph LR\n  A --> B'} />);
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveTextContent(
      'A --> B',
    );
    expect(await screen.findByTestId('diagram')).toBeInTheDocument();
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', theme: 'default' }),
    );
    expect(mermaidRender).toHaveBeenCalledWith(
      expect.stringMatching(/^mermaid-/),
      'graph LR\n  A --> B',
    );
  });

  it('uses the dark theme and redraws when the theme changes', async () => {
    const initialize = vi.fn();
    const mermaidRender = vi.fn().mockResolvedValue({ svg: '<svg></svg>' });
    vi.doMock('mermaid', () => ({
      default: { initialize, render: mermaidRender },
    }));
    const { Mermaid: Fresh } = await import('./mermaid.tsx');
    document.documentElement.classList.add('dark');
    render(<Fresh chart="graph LR" />);
    await waitFor(() =>
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: 'dark' }),
      ),
    );
    document.documentElement.classList.remove('dark');
    await waitFor(() =>
      expect(initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: 'default' }),
      ),
    );
  });

  it('keeps showing the source if the diagram is invalid', async () => {
    vi.doMock('mermaid', () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn().mockRejectedValue(new Error('Parse error')),
      },
    }));
    const { Mermaid: Fresh } = await import('./mermaid.tsx');
    render(<Fresh chart="not a diagram" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveTextContent(
      'not a diagram',
    );
  });

  it('is exported', () => {
    expect(Mermaid).toBeTypeOf('function');
  });
});
