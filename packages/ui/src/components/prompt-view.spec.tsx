import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Accordion, Accordions } from './accordion.tsx';
import { Card, Cards } from './cards.tsx';
import { Tree } from './files.tsx';
import { Prompt } from './prompt.tsx';
import { View } from './view.tsx';
import { Visibility } from './visibility.tsx';

describe('Prompt', () => {
  it('copies the prompt text', async () => {
    const user = userEvent.setup();
    render(<Prompt description="Write docs">{'Be clear.'}</Prompt>);
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: /copy prompt/i }));
    expect(write).toHaveBeenCalledWith('Be clear.');
  });

  it('shows only the actions asked for', () => {
    render(
      <Prompt description="x" actions={['cursor']}>
        text
      </Prompt>,
    );
    expect(screen.queryByRole('button', { name: /copy prompt/i })).toBeNull();
    expect(
      screen.getByRole('button', { name: /open in cursor/i }),
    ).toBeInTheDocument();
  });
});

describe('View', () => {
  it('shows one view at a time with a selector', async () => {
    const user = userEvent.setup();
    render(
      <>
        <View title="JavaScript">js body</View>
        <View title="Python">py body</View>
      </>,
    );
    await act(async () => undefined);
    expect(screen.getByText('js body')).toBeVisible();
    expect(screen.getByText('py body')).not.toBeVisible();
    await user.selectOptions(screen.getByRole('combobox'), 'Python');
    expect(screen.getByText('py body')).toBeVisible();
    expect(screen.getByText('js body')).not.toBeVisible();
  });
});

describe('Visibility', () => {
  it('shows humans content and hides agents content', () => {
    render(
      <>
        <Visibility for="humans">for people</Visibility>
        <Visibility for="agents">for agents</Visibility>
      </>,
    );
    expect(screen.getByText('for people')).toBeInTheDocument();
    expect(screen.queryByText('for agents')).toBeNull();
  });
});

describe('Tree and new props', () => {
  it('Tree is a file tree with Tree.Folder and Tree.File', () => {
    render(
      <Tree>
        <Tree.Folder name="src">
          <Tree.File name="a.ts" />
        </Tree.Folder>
      </Tree>,
    );
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
  });

  it('Accordion defaultOpen opens that section', () => {
    render(
      <Accordions>
        <Accordion title="A">a</Accordion>
        <Accordion title="B" defaultOpen description="more">
          b
        </Accordion>
      </Accordions>,
    );
    expect(screen.getByRole('button', { name: /B/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('more')).toBeInTheDocument();
  });

  it('Card takes img, horizontal and arrow', () => {
    const { container } = render(
      <Cards>
        <Card title="T" href="/x" img="/p.png" horizontal arrow icon="rocket" />
      </Cards>,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/p.png');
  });
});
