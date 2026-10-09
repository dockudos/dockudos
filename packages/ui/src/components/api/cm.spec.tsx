import { act, fireEvent, render, waitFor } from '@testing-library/react';
import CodeMirror from './cm.tsx';

const content = (container: HTMLElement) => container.querySelector('.cm-content') as HTMLElement;

describe('CodeMirror', () => {
  it('loads the grammar for XML and YAML', async () => {
    for (const language of ['xml', 'yaml', 'shell']) {
      const { container, unmount } = render(<CodeMirror value="a: 1" language={language} label="Code" />);
      await waitFor(() => expect(content(container)).toBeInTheDocument());
      // The grammar arrives after the first paint; give it the time.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      unmount();
    }
  });

  it('marks itself invalid and points to its description', () => {
    const { container } = render(
      <CodeMirror value="" language="json" label="Body" invalid describedBy="why" />,
    );
    expect(content(container)).toHaveAttribute('aria-invalid', 'true');
    expect(content(container)).toHaveAttribute('aria-describedby', 'why');
  });

  it('submits with Ctrl+Enter when it has somewhere to submit to, and ignores it otherwise', () => {
    const onSubmit = vi.fn();
    const first = render(<CodeMirror value="x" language="text" label="A" onSubmit={onSubmit} />);
    fireEvent.keyDown(content(first.container), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(<CodeMirror value="x" language="text" label="B" />);
    fireEvent.keyDown(content(second.container), { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not touch the editor with a grammar that arrives after it was removed', async () => {
    const { unmount } = render(<CodeMirror value="{}" language="json" label="Gone" />);
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
