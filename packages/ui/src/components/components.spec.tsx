import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Accordion, Accordions } from './accordion.tsx';
import { Banner } from './banner.tsx';
import { Callout } from './callout.tsx';
import { Card, Cards } from './cards.tsx';
import { CodeBlock, CodeGroup } from './code-block.tsx';
import { CopyButton, codeText } from './copy-button.tsx';
import { File, Files, Folder } from './files.tsx';
import { Step, Steps } from './steps.tsx';
import { Tab, Tabs } from './tabs.tsx';
import { Tooltip } from './tooltip.tsx';
import { TypeTable } from './type-table.tsx';
import { ZoomableImage } from './zoomable-image.tsx';

beforeEach(() => localStorage.clear());

describe('Callout', () => {
  it.each(['note', 'info', 'tip', 'warning', 'danger'] as const)(
    'renders %s with a default title',
    (type) => {
      render(<Callout type={type}>Body</Callout>);
      const note = screen.getByRole('note');
      expect(note).toHaveAttribute('data-callout', type);
      expect(
        within(note).getByText(type[0]!.toUpperCase() + type.slice(1)),
      ).toBeInTheDocument();
      expect(within(note).getByText('Body')).toBeInTheDocument();
    },
  );

  it('uses a custom title and falls back to note for an unknown type', () => {
    render(
      <Callout type={'bogus' as never} title="Heads up">
        x
      </Callout>,
    );
    expect(screen.getByRole('note')).toHaveAttribute('data-callout', 'note');
    expect(screen.getByText('Heads up')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  const tabs = (
    <Tabs>
      <Tab value="One">first</Tab>
      <Tab value="Two">second</Tab>
      <Tab value="Three">third</Tab>
    </Tabs>
  );

  it('takes its labels from the Tab children and shows the first panel', () => {
    render(tabs);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'One',
      'Two',
      'Three',
    ]);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('first');
  });

  it('is keyboard operable: arrows move and select, panel follows', async () => {
    const user = userEvent.setup();
    render(tabs);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('second');
    await user.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('third');
  });

  it('keeps tabs with the same groupId in step and remembers the choice', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tabs groupId="pm" data-testid="a">
          <Tab value="npm">npm a</Tab>
          <Tab value="pnpm">pnpm a</Tab>
        </Tabs>
        <Tabs groupId="pm">
          <Tab value="npm">npm b</Tab>
          <Tab value="pnpm">pnpm b</Tab>
        </Tabs>
      </>,
    );
    await user.click(screen.getAllByRole('tab', { name: 'pnpm' })[0]!);
    expect(screen.getAllByRole('tabpanel').map((p) => p.textContent)).toEqual([
      'pnpm a',
      'pnpm b',
    ]);
    expect(localStorage.getItem('dockudos-tabs-pm')).toBe('pnpm');
  });

  it('restores a remembered choice', () => {
    localStorage.setItem('dockudos-tabs-pm', 'pnpm');
    render(
      <Tabs groupId="pm">
        <Tab value="npm">npm</Tab>
        <Tab value="pnpm">pnpm</Tab>
      </Tabs>,
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('pnpm');
  });
});

describe('Accordion', () => {
  it('toggles with Enter and Space, one at a time by default', async () => {
    const user = userEvent.setup();
    render(
      <Accordions>
        <Accordion title="A">alpha</Accordion>
        <Accordion title="B">beta</Accordion>
      </Accordions>,
    );
    const a = screen.getByRole('button', { name: 'A' });
    const b = screen.getByRole('button', { name: 'B' });
    expect(a).toHaveAttribute('aria-expanded', 'false');
    a.focus();
    await user.keyboard('{Enter}');
    expect(a).toHaveAttribute('aria-expanded', 'true');
    b.focus();
    await user.keyboard(' ');
    expect(b).toHaveAttribute('aria-expanded', 'true');
    expect(a).toHaveAttribute('aria-expanded', 'false');
  });

  it('allows several open with multiple', async () => {
    const user = userEvent.setup();
    render(
      <Accordions multiple>
        <Accordion title="A">alpha</Accordion>
        <Accordion title="B">beta</Accordion>
      </Accordions>,
    );
    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'B' }));
    expect(
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-expanded')),
    ).toEqual(['true', 'true']);
  });
});

describe('Tooltip', () => {
  it('shows on keyboard focus and hides on Escape', async () => {
    const user = userEvent.setup();
    render(<Tooltip tip="Markdown with components">MDX</Tooltip>);
    await user.tab();
    expect(screen.getByText('MDX')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Markdown with components',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Steps, Cards, Files, TypeTable', () => {
  it('renders steps as an ordered list', () => {
    render(
      <Steps>
        <Step title="Install">a</Step>
        <Step title="Run">b</Step>
      </Steps>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getByRole('heading', { name: 'Install' }),
    ).toBeInTheDocument();
  });

  it('renders cards, as links when given an href', () => {
    render(
      <Cards>
        <Card title="Local" href="/a">
          x
        </Card>
        <Card title="Remote" href="https://x.dev">
          y
        </Card>
        <Card title="Plain">z</Card>
      </Cards>,
    );
    expect(screen.getByRole('link', { name: 'Local x' })).toHaveAttribute(
      'href',
      '/a',
    );
    const remote = screen.getByRole('link', { name: 'Remote y' });
    expect(remote).toHaveAttribute('target', '_blank');
    expect(remote).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('renders a file tree with folders that open', async () => {
    const user = userEvent.setup();
    render(
      <Files>
        <Folder name="src">
          <File name="index.ts" />
        </Folder>
      </Files>,
    );
    expect(screen.getByRole('tree')).toBeInTheDocument();
    await user.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeVisible();
  });

  it('renders a type table with required and default markers', () => {
    render(
      <TypeTable
        type={{
          name: { type: 'string', required: true },
          size: { type: 'number', default: '3' },
        }}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /name/ })).toHaveTextContent(
      '(required)',
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('Banner', () => {
  it('is dismissible when it has an id, and stays dismissed', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Banner id="v2">Version 2 is out</Banner>);
    expect(
      screen.getByRole('region', { name: 'Announcement' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Dismiss announcement' }),
    );
    expect(screen.queryByText('Version 2 is out')).not.toBeInTheDocument();
    unmount();
    render(<Banner id="v2">Version 2 is out</Banner>);
    expect(screen.queryByText('Version 2 is out')).not.toBeInTheDocument();
  });

  it('has no dismiss button without an id', () => {
    render(<Banner>Hi</Banner>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ZoomableImage', () => {
  it('opens full size on click and closes with Escape', async () => {
    const user = userEvent.setup();
    render(
      <ZoomableImage src="/a.png" alt="A diagram" width={10} height={5} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Zoom image: A diagram' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('img', { name: 'A diagram' }),
    ).toHaveAttribute('src', '/a.png');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('accepts an imported image object and uses its size', () => {
    render(
      <ZoomableImage
        src={{ src: '/_next/x.png', width: 40, height: 20 }}
        alt=""
      />,
    );
    const img = screen.getByRole('presentation', {
      hidden: true,
    }) as HTMLImageElement;
    expect(img).toHaveAttribute('src', '/_next/x.png');
    expect(img).toHaveAttribute('width', '40');
  });
});

describe('CodeBlock', () => {
  const block = (props: object = {}) => (
    <CodeBlock {...props}>
      <code>
        <span className="line">const a = 1;</span>
        {'\n'}
        <span className="line diff remove">old</span>
        {'\n'}
        <span className="twoslash-popup-container">popup</span>
      </code>
    </CodeBlock>
  );

  it('leaves a pre without a language as a plain pre (hand-written, or inside a Twoslash popup)', () => {
    const { container } = render(<CodeBlock><code>plain</code></CodeBlock>);
    expect(container.querySelector('figure')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument();
    expect(container.querySelector('pre')).toHaveTextContent('plain');
  });

  it('renders the title and a copy button', () => {
    render(block({ 'data-title': 'a.ts', 'data-language': 'ts' }));
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy code' }),
    ).toBeInTheDocument();
  });

  it('copies the code without removed diff lines or popups, and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(block({ 'data-language': 'ts' }));
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copied to clipboard',
    );
  });

  it('reports a failed copy', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(block({ 'data-language': 'ts' }));
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed');
  });

  it('codeText strips removed lines', () => {
    const div = document.createElement('div');
    div.innerHTML =
      '<span class="line">keep</span>\n<span class="line diff remove">drop</span>';
    expect(codeText(div)).toBe('keep');
  });

  it('labels a code group by block titles, looking through fragments', () => {
    render(
      <CodeGroup>
        <>
          <CodeBlock data-title="a.ts" data-language="ts">
            <code>a</code>
          </CodeBlock>
        </>
        <CodeBlock data-title="b.js" data-language="js">
          <code>b</code>
        </CodeBlock>
      </CodeGroup>,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'a.ts',
      'b.js',
    ]);
  });
});

it('CopyButton renders inside no block without crashing on click', async () => {
  const user = userEvent.setup();
  render(<CopyButton />);
  await user.click(screen.getByRole('button'));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});
