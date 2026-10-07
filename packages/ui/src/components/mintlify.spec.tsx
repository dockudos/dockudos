import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccordionGroup, Accordion } from './accordion.tsx';
import { Card, CardGroup } from './cards.tsx';
import {
  Check,
  Danger,
  Info,
  Note,
  Tip,
  Warning,
  Callout,
} from './callout.tsx';
import { Colors } from './colors.tsx';
import { Icon } from './icon.tsx';
import { Panel, RequestExample, ResponseExample } from './panel.tsx';
import { Shortcut } from './shortcut.tsx';
import { Step, Steps } from './steps.tsx';
import { Tile } from './tile.tsx';
import { CodeBlock } from './code-block.tsx';
import { ICON_NAMES } from '../lib/icons.ts';
import { mdxComponents } from '../mdx/components.tsx';

describe('Icon', () => {
  it('renders a named icon, hidden from screen readers unless labelled', () => {
    const { container } = render(
      <>
        <Icon name="rocket" />
        <Icon name="book-open" label="Docs" size={24} />
      </>,
    );
    const [a, b] = [...container.querySelectorAll('svg')];
    expect(a).toHaveAttribute('aria-hidden', 'true');
    expect(b).toHaveAttribute('aria-label', 'Docs');
    expect(b).toHaveAttribute('width', '24');
  });

  it('knows aliases and ignores case', () => {
    const { container } = render(
      <>
        <Icon name="home" />
        <Icon name="Check-Circle" />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('fails on an unknown name and suggests close ones', () => {
    expect(() => render(<Icon name="rokcet" />)).toThrow(/no such icon/);
    expect(() => render(<Icon name="roc" />)).toThrow(/rocket/);
  });

  it('has a sensible list', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(150);
    expect(ICON_NAMES).toEqual(
      expect.arrayContaining([
        'rocket',
        'shield-check',
        'terminal',
        'settings',
      ]),
    );
  });
});

describe('icons in other components', () => {
  it('Card, Step, Accordion and Callout take an icon name or an element', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <Card title="C" icon="rocket" />
        <Steps>
          <Step title="S" icon="key">
            x
          </Step>
        </Steps>
        <AccordionGroup>
          <Accordion title="A" icon="lock">
            y
          </Accordion>
        </AccordionGroup>
        <Callout type="tip" icon="sparkles">
          z
        </Callout>
        <Card title="Custom" icon={<svg data-testid="mine" />} />
      </>,
    );
    expect(
      container.querySelectorAll('svg.lucide, svg[width]').length,
    ).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('mine')).toBeInTheDocument();
    expect(container.querySelector('.dk-step')).toHaveAttribute(
      'data-has-icon',
    );
    await user.click(screen.getByRole('button', { name: 'A' }));
  });

  it('an unknown icon name stops the page from building', () => {
    expect(() => render(<Card title="C" icon="nope-nope" />)).toThrow(
      /no such icon/,
    );
  });
});

describe('names from other tools', () => {
  it('Note, Info, Tip, Check, Warning and Danger are callouts', () => {
    render(
      <>
        <Note>a</Note>
        <Info>b</Info>
        <Tip>c</Tip>
        <Check>d</Check>
        <Warning>e</Warning>
        <Danger>f</Danger>
      </>,
    );
    expect(
      screen.getAllByRole('note').map((n) => n.getAttribute('data-callout')),
    ).toEqual(['note', 'info', 'tip', 'check', 'warning', 'danger']);
  });

  it('CardGroup takes cols or columns; AccordionGroup works like Accordions', () => {
    const { container } = render(
      <CardGroup cols={3}>
        <Card title="x" />
      </CardGroup>,
    );
    expect(container.firstElementChild).toHaveClass('lg:grid-cols-3');
    expect(CardGroup).toBeTypeOf('function');
  });

  it('all of them are available in MDX by name', () => {
    for (const name of [
      'Note',
      'Info',
      'Tip',
      'Check',
      'Warning',
      'Danger',
      'CardGroup',
      'AccordionGroup',
      'Icon',
      'Tile',
      'Colors',
      'Panel',
      'RequestExample',
      'ResponseExample',
      'Shortcut',
    ]) {
      expect(mdxComponents, name).toHaveProperty(name);
    }
  });
});

describe('Tile', () => {
  it('shows a preview, title and description, and links', () => {
    render(
      <Tile title="Starter" description="A small site" href="/starter">
        <img alt="Preview" src="/p.png" />
      </Tile>,
    );
    const link = screen.getByRole('link', { name: /Starter/ });
    expect(link).toHaveAttribute('href', '/starter');
    expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
  });

  it('opens external links in a new tab', () => {
    render(<Tile title="Out" href="https://x.dev" />);
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
  });
});

describe('Colors', () => {
  it('copies a swatch value on click and says which', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <Colors
        title="Brand"
        items={[
          { name: 'Primary', value: '#4f46e5' },
          { name: 'Accent', value: 'oklch(0.9 0.1 90)' },
        ]}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Copy Primary, #4f46e5' }),
    );
    expect(writeText).toHaveBeenCalledWith('#4f46e5');
    expect(await screen.findByText('Copied Primary')).toBeInTheDocument();
  });
});

describe('Panel and examples', () => {
  it('labels request and response examples, with code as tabs', () => {
    render(
      <Panel>
        <RequestExample>
          <CodeBlock data-title="curl" data-language="bash">
            <code>curl x</code>
          </CodeBlock>
          <CodeBlock data-title="Node" data-language="js">
            <code>fetch(x)</code>
          </CodeBlock>
        </RequestExample>
        <ResponseExample>
          <CodeBlock data-title="200" data-language="json">
            <code>{'{}'}</code>
          </CodeBlock>
        </ResponseExample>
      </Panel>,
    );
    expect(
      screen.getByRole('complementary', { name: 'Examples' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Request' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Response' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'curl',
      'Node',
      '200',
    ]);
  });
});

describe('Shortcut', () => {
  it('shows keys, with "then" between the steps of a sequence', () => {
    const { container } = render(
      <>
        <Shortcut keys="mod+k" />
        <Shortcut keys="g h" />
      </>,
    );
    const [first, second] = [...container.querySelectorAll('.dk-shortcut')];
    expect(
      [...first!.querySelectorAll('kbd')].map((k) => k.textContent),
    ).toEqual(['Ctrl', 'K']);
    expect(second!.textContent).toContain('then');
  });
});
