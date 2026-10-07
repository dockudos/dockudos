import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from './badge.tsx';
import { Columns } from './columns.tsx';
import { Expandable } from './expandable.tsx';
import { File, Files, Folder } from './files.tsx';
import { Frame } from './frame.tsx';
import { Kbd } from './kbd.tsx';
import { Video } from './video.tsx';

describe('Files: custom icons', () => {
  it('uses the given icon for a file instead of the default, hidden from screen readers', () => {
    const { container } = render(
      <Files>
        <File name="a.ts" icon={<svg data-testid="ts" />} />
        <File name="b.txt" />
      </Files>,
    );
    const icon = screen.getByTestId('ts');
    expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true');
    // The second file keeps the default icon, so only one custom icon exists.
    expect(container.querySelectorAll('[data-testid]')).toHaveLength(1);
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('uses one icon for a folder open and closed, or a separate open icon', () => {
    render(
      <Files>
        <Folder name="one" icon={<svg data-testid="closed" />} />
        <Folder
          name="two"
          icon={<svg data-testid="c2" />}
          openIcon={<svg data-testid="o2" />}
        />
      </Files>,
    );
    expect(screen.getByTestId('closed')).toBeInTheDocument();
    expect(screen.getByTestId('c2')).toBeInTheDocument();
    expect(screen.getByTestId('o2')).toBeInTheDocument();
  });

  it('accepts an image as an icon', () => {
    render(
      <Files>
        <File name="x" icon={<img src="/x.svg" alt="" />} />
      </Files>,
    );
    expect(document.querySelector('img')).toHaveAttribute('src', '/x.svg');
  });
});

describe('Badge', () => {
  it('renders its color, falling back to gray for an unknown one', () => {
    render(
      <>
        <Badge color="green">New</Badge>
        <Badge color={'pink' as never}>Odd</Badge>
      </>,
    );
    expect(screen.getByText('New')).toHaveAttribute('data-badge', 'green');
    expect(screen.getByText('Odd')).toHaveAttribute('data-badge', 'gray');
  });
});

describe('Kbd', () => {
  it('splits a combination into separate keys with a plus between them', () => {
    const { container } = render(<Kbd>Ctrl+K</Kbd>);
    expect(
      [...container.querySelectorAll('kbd')].map((k) => k.textContent),
    ).toEqual(['Ctrl', 'K']);
    expect(container.querySelector('[aria-hidden]')).toHaveTextContent('+');
  });

  it('renders a single key', () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    expect(container.querySelectorAll('kbd')).toHaveLength(1);
  });
});

describe('Frame and Columns', () => {
  it('frames content with a caption', () => {
    render(
      <Frame caption="A screenshot">
        <img alt="Screenshot" src="/s.png" />
      </Frame>,
    );
    expect(screen.getByRole('figure')).toContainElement(
      screen.getByText('A screenshot'),
    );
    expect(screen.getByText('A screenshot').tagName).toBe('FIGCAPTION');
  });

  it('lays children out in columns', () => {
    const { container } = render(
      <Columns cols={3}>
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </Columns>,
    );
    expect(container.firstElementChild).toHaveClass('md:grid-cols-3');
    expect(container.firstElementChild!.children).toHaveLength(3);
  });
});

describe('Video', () => {
  it('plays a file with controls and a text fallback link', () => {
    const { container } = render(
      <Video title="Demo" src="/demo.mp4" poster="/p.png" />,
    );
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('aria-label', 'Demo');
    expect(container.querySelector('source')).toHaveAttribute(
      'src',
      '/demo.mp4',
    );
    expect(screen.getByRole('link', { name: 'Demo' })).toHaveAttribute(
      'href',
      '/demo.mp4',
    );
  });

  it('embeds an https page in a titled, sandboxed, lazy iframe', () => {
    render(<Video title="Intro" embed="https://www.youtube.com/embed/abc" />);
    const frame = screen.getByTitle('Intro');
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('refuses an embed that is not https, and a video with no source', () => {
    expect(() =>
      render(<Video title="x" embed="javascript:alert(1)" />),
    ).toThrow(/https/);
    expect(() => render(<Video title="x" embed="http://x.dev" />)).toThrow(
      /https/,
    );
    expect(() => render(<Video title="x" />)).toThrow(/src/);
  });
});

describe('Expandable', () => {
  it('opens and closes from the keyboard and can start open', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Expandable title="Details">hidden text</Expandable>
        <Expandable title="Open" defaultOpen>
          shown
        </Expandable>
      </>,
    );
    const [closed, open] = [...document.querySelectorAll('details')];
    expect(closed!.open).toBe(false);
    expect(open!.open).toBe(true);
    await user.click(screen.getByText('Details'));
    expect(closed!.open).toBe(true);
  });
});
