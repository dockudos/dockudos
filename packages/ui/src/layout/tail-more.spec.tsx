import { render, screen } from '@testing-library/react';
import { GraphView } from '../components/graph-view.tsx';
import { hotkeys } from '../hooks/hotkeys.ts';
import { scoreEntry } from './command-palette.tsx';
import { TutorialHeader } from './tutorial-header.tsx';

describe('tail ends', () => {
  it('scores a word at the start of a later word in the title', () => {
    expect(scoreEntry({ title: 'My Authentication', path: '/a' }, 'auth')).toBe(40);
  });

  it('updates only the entry asked for', () => {
    const one = vi.fn();
    const two = vi.fn();
    const next = vi.fn();
    const offOne = hotkeys.register({ keys: ['f7'], handler: one, description: 'One' });
    const offTwo = hotkeys.register({ keys: ['f6'], handler: two, description: 'Two' });
    const entry = hotkeys.list().find((e) => e.handler === one) as { id: number };
    hotkeys.update(entry.id, { handler: next });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7' }));
    expect(two).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
    offOne();
    offTwo();
  });

  it('keeps the list of visited steps as it is when the step was visited before', () => {
    const steps = [
      { path: '/a', title: 'A' },
      { path: '/b', title: 'B' },
    ];
    localStorage.clear();
    const first = render(<TutorialHeader title="Again" step={1} steps={steps} />);
    first.unmount();
    render(<TutorialHeader title="Again" step={1} steps={steps} />);
    expect(JSON.parse(localStorage.getItem('dockudos-tutorial:Again') as string)).toEqual(['/a']);
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
  });

  it('describes the graph in Markdown', () => {
    const twin = (GraphView as unknown as { toMarkdown: () => string }).toMarkdown;
    expect(twin()).toContain('graph of how the pages');
  });
});
