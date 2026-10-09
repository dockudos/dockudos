import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageDataProvider } from '../docs-context.tsx';
import { CopyButton } from './copy-button.tsx';
import { CopyText } from './copy-text.tsx';
import { GraphView } from './graph-view.tsx';
import { InlineToc } from './inline-toc.tsx';
import { Card } from './cards.tsx';

const graph = {
  nodes: [
    { id: 'a', title: 'A', path: '/a' },
    { id: 'b', title: 'B', path: '/b' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'missing' },
    { from: 'missing', to: 'b' },
  ],
};

describe('page-aware components', () => {
  it('graph: uses the page’s graph, marks the current page, skips edges to unknown pages', () => {
    const { container } = render(
      <PageDataProvider value={{ toc: [], path: '/b', graph }}>
        <GraphView />
      </PageDataProvider>,
    );
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'A' })).not.toHaveAttribute('aria-current');
  });

  it('graph: explicit data wins over the page’s; nothing when there is none or it is empty', () => {
    const { container, rerender } = render(<GraphView data={graph} />);
    expect(container.querySelectorAll('a')).toHaveLength(2);
    rerender(<GraphView />);
    expect(container.firstChild).toBeNull();
    rerender(<GraphView data={{ nodes: [], edges: [] }} />);
    expect(container.firstChild).toBeNull();
  });

  it('inline toc: lists the page’s own headings', () => {
    render(
      <PageDataProvider value={{ toc: [{ id: 'h', text: 'Heading', depth: 2 }], path: '/' }}>
        <InlineToc />
      </PageDataProvider>,
    );
    expect(screen.getByRole('link', { name: 'Heading' })).toHaveAttribute('href', '#h');
  });
});

describe('copying', () => {
  it('copies the text it was given, not the code block around it', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CopyButton text="npm i" />);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(write).toHaveBeenCalledWith('npm i');
    write.mockRestore();
  });

  it('copy text: copies the shown text, or a given value', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(
      <>
        <CopyText>shown</CopyText>
        <CopyText value="hidden">label</CopyText>
      </>,
    );
    const [one, two] = screen.getAllByRole('button', { name: 'Copy' });
    await user.click(one as HTMLElement);
    await user.click(two as HTMLElement);
    expect(write.mock.calls.map((c) => c[0])).toEqual(['shown', 'hidden']);
    write.mockRestore();
  });

  it('card twin without a title', () => {
    const twin = (Card as unknown as { toMarkdown: (p: object, c: string) => string }).toMarkdown;
    expect(typeof twin({}, 'x')).toBe('string');
  });
});
