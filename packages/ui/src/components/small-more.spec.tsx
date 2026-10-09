import { act, render, screen } from '@testing-library/react';
import { Columns } from './columns.tsx';
import { CodeGroup } from './code-block.tsx';
import { InlineToc } from './inline-toc.tsx';
import { Kbd } from './kbd.tsx';
import { NavigationNoticeView, announceNavigation } from './navigation-notice.tsx';
import { ParamField, ResponseField } from './param-field.tsx';
import { renderIcon } from './render-icon.tsx';
import { Step } from './steps.tsx';
import { Tab } from './tab-panel.tsx';
import { Tabs } from './tabs.tsx';
import { TabsRoot } from './tabs-root.tsx';
import { Visibility } from './visibility.tsx';

type Twin = (
  props: Record<string, unknown>,
  children: string,
  ctx?: Record<string, unknown>,
) => string;
const twin = (c: unknown) => (c as { toMarkdown: Twin }).toMarkdown;

describe('layout and text components', () => {
  it('columns: two, three and four', () => {
    const cls = (cols: 2 | 3 | 4) => {
      const { container, unmount } = render(<Columns cols={cols}>x</Columns>);
      const c = container.firstElementChild?.className ?? '';
      unmount();
      return c;
    };
    expect(cls(2)).toContain('md:grid-cols-2');
    expect(cls(3)).toContain('md:grid-cols-3');
    expect(cls(4)).toContain('lg:grid-cols-4');
  });

  it('inline toc: takes explicit items, or none at all', () => {
    const { container, rerender } = render(
      <InlineToc items={[{ id: 'a', text: 'Alpha', depth: 3 }]} />,
    );
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '#a');
    rerender(<InlineToc items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('kbd: a key that is not text is kept as it is', () => {
    const { container } = render(<Kbd>{<b>Cmd</b>}</Kbd>);
    expect(container.querySelector('kbd b')).toBeInTheDocument();
  });

  it('render icon: a name, an empty name, an element, and nothing', () => {
    expect(renderIcon('')).toBeNull();
    expect(renderIcon(undefined)).toBeNull();
    expect(renderIcon(null)).toBeNull();
    const el = <i>x</i>;
    expect(renderIcon(el)).toBe(el);
    expect(renderIcon('rocket')).not.toBeNull();
  });

  it('visibility: humans see it, agents do not, anything else is an error', () => {
    const { container } = render(
      <>
        <Visibility for="humans">for people</Visibility>
        <Visibility for="agents">for tools</Visibility>
      </>,
    );
    expect(container.textContent).toBe('for people');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(<Visibility for={'robots' as 'humans'}>x</Visibility>),
    ).toThrow('use "humans" or "agents"');
    quiet.mockRestore();
  });
});

describe('tabs', () => {
  it('takes its tabs from the children that have a text value', () => {
    render(
      <Tabs>
        <Tab value="one">1</Tab>
        {/* @ts-expect-error a tab without a text value is skipped, not an error */}
        <Tab value={2}>2</Tab>
      </Tabs>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('code group: names a block without a title by its position', () => {
    render(
      <CodeGroup>
        <pre data-title="Named">a</pre>
        <pre>b</pre>
      </CodeGroup>,
    );
    expect(screen.getByRole('tab', { name: 'Named' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab 2' })).toBeInTheDocument();
  });

  it('a group ignores a change in another group or to a tab it does not have', () => {
    render(
      <TabsRoot items={['a', 'b']} groupId="g1">
        <Tab value="a">A body</Tab>
        <Tab value="b">B body</Tab>
      </TabsRoot>,
    );
    const send = (groupId: string, value: string) =>
      act(() => {
        window.dispatchEvent(
          new CustomEvent('dockudos:tabs', { detail: { groupId, value } }),
        );
      });
    const selected = () => screen.getByRole('tab', { selected: true }).textContent;
    send('other', 'b');
    expect(selected()).toBe('a');
    send('g1', 'zzz');
    expect(selected()).toBe('a');
    send('g1', 'b');
    expect(selected()).toBe('b');
  });
});

describe('navigation notice', () => {
  it('goes away by itself after a while, and a newer notice restarts the wait', () => {
    vi.useFakeTimers();
    try {
      render(<NavigationNoticeView />);
      act(() => announceNavigation({ title: 'First', reason: 'because' }));
      expect(screen.getByRole('status')).toHaveTextContent('First');
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      act(() => announceNavigation({ title: 'Second', reason: 'again' }));
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('Second');
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('twins with more facts', () => {
  it('param and response fields', () => {
    expect(twin(ParamField)({}, 'x')).toContain('**``**');
    expect(
      twin(ParamField)(
        { path: 'id', type: 'string', location: 'path', required: true, default: '1' },
        'The id',
      ).trim(),
    ).toBe('**`id`** (string, in path, required, default 1)\n\nThe id');
    expect(twin(ResponseField)({ name: 'ok' }, 'Fine')).toContain('**`ok`**');
  });

  it('step: with and without a title; tab: by value, title, label or nothing', () => {
    const ctx = { index: 1 };
    expect(twin(Step)({ title: 'Go' }, 'x', ctx)).toContain('**2. Go**');
    expect(twin(Step)({}, 'x', ctx)).toContain('**Step 2**');
    expect(twin(Tab)({ value: 'v' }, 'x')).toContain('**v**');
    expect(twin(Tab)({ title: 't' }, 'x')).toContain('**t**');
    expect(twin(Tab)({ label: 'l' }, 'x')).toContain('**l**');
    expect(twin(Tab)({}, 'x')).not.toContain('**');
  });

});
