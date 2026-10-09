import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Accordion } from './accordion.tsx';
import { Badge } from './badge.tsx';
import { Banner } from './banner.tsx';
import { Card, Cards } from './cards.tsx';
import { ChecklistItem } from './checklist.tsx';
import { Colors } from './colors.tsx';
import { CopyText } from './copy-text.tsx';
import { Download } from './download.tsx';
import { Exercise, Hint, Solution } from './exercise.tsx';
import { Expandable } from './expandable.tsx';
import { Frame } from './frame.tsx';
import { GithubInfo } from './github-info.tsx';
import { Hero, LinkButton } from './hero.tsx';
import { RequestExample, ResponseExample } from './panel.tsx';
import { Prompt } from './prompt.tsx';
import { Quote } from './quote.tsx';
import { Shortcut } from './shortcut.tsx';
import { Stat } from './stats.tsx';
import { ThemedImage } from './themed-image.tsx';
import { Tile } from './tile.tsx';
import { TimelineItem } from './timeline.tsx';
import { Tooltip } from './tooltip.tsx';
import { Update } from './update.tsx';
import { Deprecated, Since } from './version-labels.tsx';
import { Video } from './video.tsx';
import { Table } from './table.tsx';
import { Button } from './button.tsx';

type Twin = (props: Record<string, unknown>, children: string) => string;
const twin = (c: unknown) => (c as { toMarkdown: Twin }).toMarkdown;

describe('Markdown twins, called directly', () => {
  it('accordion: title, with or without a description', () => {
    expect(twin(Accordion)({ title: 'T' }, 'body')).toContain('**T**');
    expect(twin(Accordion)({ title: 'T', description: 'D' }, 'body')).toContain(
      'D',
    );
  });

  it('badge, banner, copy text: the trimmed content', () => {
    expect(twin(Badge)({}, ' New ')).toBe('**New**');
    expect(twin(Banner)({}, 'Hi')).toContain('Hi');
    expect(twin(CopyText)({}, ' npm i ')).toBe('`npm i`');
  });

  it('card: with and without a link', () => {
    expect(twin(Card)({ title: 'A', href: '/a' }, 'x')).toContain('[A](/a)');
    expect(twin(Card)({ title: 'A' }, 'x')).toContain('**A**');
  });

  it('checklist item: ticked or not', () => {
    expect(twin(ChecklistItem)({ checked: true }, ' done ')).toContain('[x] done');
    expect(twin(ChecklistItem)({}, 'todo')).toContain('[ ] todo');
  });

  it('colors: with and without a title or items', () => {
    const items = [{ name: 'Primary', value: '#fff' }];
    expect(twin(Colors)({ title: 'Brand', items }, '')).toContain('**Brand**');
    expect(twin(Colors)({ items }, '')).toContain('`#fff`');
    expect(typeof twin(Colors)({}, '')).toBe('string');
  });

  it('download: with and without a size', () => {
    expect(twin(Download)({ href: '/a.pdf', size: '2 MB' }, ' Guide ')).toBe(
      '[Guide](/a.pdf) (2 MB)',
    );
    expect(twin(Download)({ href: '/a.pdf' }, 'Guide')).toBe('[Guide](/a.pdf)');
  });

  it('exercise, hint and solution: default and given titles', () => {
    expect(twin(Exercise)({}, 'Task')).toContain('**Exercise**');
    expect(twin(Exercise)({ title: 'Try' }, 'Task')).toContain('**Try**');
    expect(twin(Hint)({}, 'x')).toContain('**Hint**');
    expect(twin(Hint)({ title: 'Nudge' }, 'x')).toContain('**Hint: Nudge**');
    expect(twin(Solution)({}, 'x')).toContain('**Solution**');
  });

  it('expandable, frame, github info', () => {
    expect(twin(Expandable)({ title: 'More' }, 'x')).toContain('**More**');
    expect(twin(Frame)({ caption: 'Cap' }, ' img ')).toContain('_Cap_');
    expect(twin(Frame)({}, ' img ')).not.toContain('_');
    expect(twin(GithubInfo)({ owner: 'a', repo: 'b' }, '')).toContain(
      '[a/b](https://github.com/a/b)',
    );
  });

  it('hero and link button', () => {
    expect(
      twin(Hero)({ eyebrow: 'New', title: 'T', description: 'D' }, ''),
    ).toContain('_New_');
    expect(twin(Hero)({ title: 'T' }, '')).toContain('**T**');
    expect(twin(LinkButton)({ href: '/go' }, ' Go ')).toBe('[Go](/go)');
  });

  it('request and response examples', () => {
    expect(twin(RequestExample)({}, 'x')).toContain('Request example');
    expect(twin(ResponseExample)({}, 'x')).toContain('Response example');
  });

  it('prompt, quote', () => {
    expect(twin(Prompt)({ description: 'Use it' }, 'text')).toContain('Use it');
    expect(
      twin(Quote)({ author: 'A', source: 'S', href: '/q' }, 'said'),
    ).toContain('— [A, S](/q)');
    expect(twin(Quote)({}, 'said')).not.toContain('—');
  });

  it('shortcut, stat', () => {
    expect(twin(Shortcut)({ keys: 'mod+k' }, '')).toBe('`mod+k`');
    expect(twin(Shortcut)({}, '')).toBe('');
    expect(
      twin(Stat)({ label: 'Up', value: '99%', description: 'month' }, ''),
    ).toContain('(month)');
    expect(twin(Stat)({ label: 'Up', value: '99%' }, '')).not.toContain('(');
  });

  it('themed image, tile, tooltip', () => {
    expect(twin(ThemedImage)({ light: '/l.png', alt: 'Shot' }, '')).toBe(
      '![Shot](/l.png)',
    );
    expect(twin(ThemedImage)({ light: '/l.png' }, '')).toBe('![](/l.png)');
    expect(
      twin(Tile)({ title: 'T', href: '/t', description: 'D' }, 'x'),
    ).toContain('[T](/t)');
    expect(twin(Tile)({ title: 'T' }, 'x')).toContain('**T**');
    expect(twin(Tooltip)({ tip: 'Hint' }, 'term')).toBe('term (Hint)');
    expect(twin(Tooltip)({}, 'term')).toBe('term');
  });

  it('timeline item: with a known, an unknown and no status', () => {
    expect(
      twin(TimelineItem)({ title: 'T', date: '2026', status: 'done' }, 'x'),
    ).toContain('(2026, Done)');
    expect(twin(TimelineItem)({ title: 'T', status: 'weird' }, 'x')).toContain(
      '**T**',
    );
    expect(twin(TimelineItem)({ title: 'T' }, 'x')).not.toContain('(');
  });

  it('update: with everything and with only a label', () => {
    expect(
      twin(Update)(
        { label: '1.0', date: '2026-01-01', tags: ['Added'], description: 'D' },
        'x',
      ),
    ).toContain('1.0');
    expect(twin(Update)({ label: '1.0' }, 'x')).toContain('**1.0**');
  });

  it('since and deprecated', () => {
    expect(twin(Since)({ version: '1.4' }, '')).toBe('_Since 1.4_');
    expect(
      twin(Deprecated)({ since: '2.0', replacedBy: 'newFn' }, 'x'),
    ).toContain('Deprecated since 2.0, use newFn instead.');
    expect(twin(Deprecated)({}, 'x')).toContain('Deprecated.');
  });

  it('video: a file, an embed, and neither', () => {
    expect(twin(Video)({ title: 'Demo', src: '/d.mp4' }, '')).toContain(
      '[Video: Demo](/d.mp4)',
    );
    expect(
      twin(Video)({ title: 'Demo', embed: 'https://x.test/e' }, ''),
    ).toContain('(https://x.test/e)');
    expect(twin(Video)({ title: 'Demo' }, '')).toContain('Video: Demo');
  });

  it('cards group is a container', () => {
    expect(twin(Cards)({}, 'inner')).toContain('inner');
  });
});

describe('Rendering branches', () => {
  it('table wraps the table in a focusable frame', () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.querySelector('.dk-table')).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('button renders as itself, as a child element, and with defaults', () => {
    const { rerender } = render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    rerender(
      <Button asChild variant="outline" size="sm">
        <a href="/x">Link</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Link' });
    expect(link).toHaveAttribute('data-variant', 'outline');
    expect(link).toHaveAttribute('data-size', 'sm');
  });

  it('banner: dismisses, survives broken storage, can be rainbow', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const { container } = render(
        <Banner id="x" variant="rainbow">
          News
        </Banner>,
      );
      expect(container.firstElementChild?.className).toContain('gradient');
      act(() => screen.getByRole('button', { name: 'Dismiss announcement' }).click());
      expect(screen.queryByText('News')).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('banner: shows when storage cannot be read', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      render(<Banner id="y">Still here</Banner>);
      expect(screen.getByText('Still here')).toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('cards: one, two and three columns, and the alias', () => {
    const cls = (cols: 1 | 2 | 3 | undefined, alias = false) => {
      const { container, unmount } = render(
        alias ? <Cards cols={cols}>x</Cards> : <Cards columns={cols}>x</Cards>,
      );
      const c = container.firstElementChild?.className ?? '';
      unmount();
      return c;
    };
    expect(cls(1)).toContain('grid-cols-1');
    expect(cls(3)).toContain('lg:grid-cols-3');
    expect(cls(undefined)).toContain('sm:grid-cols-2');
    expect(cls(3, true)).toContain('lg:grid-cols-3');
  });

  it('card: horizontal, with an image, icon, arrow and link', () => {
    const { container } = render(
      <Card
        title="C"
        href="https://x.test"
        icon="rocket"
        img="/i.png"
        horizontal
        arrow={false}
      >
        text
      </Card>,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/i.png');
    expect(container.querySelector('a')).toBeInTheDocument();
  });

  it('download: names the file from the address, and shows type and size', () => {
    render(
      <>
        <Download href="/files/guide.pdf" size="1 MB" />
        <Download href="/files/data" filename="x.csv">
          Data
        </Download>
        <Download href="/files/raw" />
      </>,
    );
    expect(screen.getByText('guide.pdf')).toBeInTheDocument();
    expect(screen.getByText('(PDF, 1 MB)')).toBeInTheDocument();
    expect(screen.getByText('(CSV)')).toBeInTheDocument();
    expect(screen.getByText('raw')).toBeInTheDocument();
  });

  it('quote: credit with and without a link', () => {
    const { container } = render(
      <>
        <Quote author="A" href="/q">
          one
        </Quote>
        <Quote source="S">two</Quote>
        <Quote>three</Quote>
      </>,
    );
    expect(container.querySelectorAll('figcaption')).toHaveLength(2);
    expect(container.querySelectorAll('figcaption a')).toHaveLength(1);
  });

  it('frame: hint and caption are optional', () => {
    const { container } = render(
      <>
        <Frame hint="Click" caption="Cap">
          x
        </Frame>
        <Frame>y</Frame>
      </>,
    );
    expect(container.querySelectorAll('figcaption')).toHaveLength(1);
    expect(screen.getByText('Click')).toBeInTheDocument();
  });

  it('deprecated: since, replacement and extra text', () => {
    const { container, rerender } = render(
      <Deprecated since="2.0" replacedBy="newFn">
        Soon gone.
      </Deprecated>,
    );
    expect(container.textContent).toContain('Deprecated in 2.0');
    expect(container.textContent).toContain('Soon gone.');
    rerender(<Deprecated />);
    expect(container.textContent).toBe('Deprecated');
  });

  it('timeline item: with a status badge, without', () => {
    const { container } = render(
      <>
        <TimelineItem title="A" date="Q3" status="current">
          body
        </TimelineItem>
        <TimelineItem title="B" />
      </>,
    );
    expect(container.querySelectorAll('[data-badge]')).toHaveLength(1);
    expect(container.querySelectorAll('.dk-timeline-body')).toHaveLength(1);
  });

  it('video: an embed needs https, a file needs a src', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Video title="v" embed="http://x.test" />)).toThrow(
      'only https',
    );
    expect(() => render(<Video title="v" />)).toThrow('needs a `src`');
    quiet.mockRestore();
    const { container } = render(
      <>
        <Video title="e" embed="https://x.test/e" ratio="4 / 3" />
        <Video title="f" src="/f.mp4" poster="/p.png" />
      </>,
    );
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://x.test/e');
    expect(container.querySelector('video')).toHaveAttribute('poster', '/p.png');
  });

  it('github info: renders numbers when reachable, and a bare link when not', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ description: 'Desc', stargazers_count: 1200, forks_count: 3 }),
      ),
    );
    const render1 = (await GithubInfo({ owner: 'a', repo: 'b' })) as ReactNode;
    const first = render(<>{render1}</>);
    expect(first.container.textContent).toContain('1.2K');
    expect(first.container.textContent).toContain('Desc');
    first.unmount();

    process.env['GITHUB_TOKEN'] = 't';
    fetchSpy.mockResolvedValueOnce(new Response('no', { status: 500 }));
    const second = render(<>{(await GithubInfo({ owner: 'a', repo: 'b' })) as ReactNode}</>);
    expect(second.container.textContent).not.toContain('stars');
    expect(fetchSpy.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer t',
    });
    delete process.env['GITHUB_TOKEN'];
    second.unmount();

    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    const third = render(<>{(await GithubInfo({ owner: 'a', repo: 'b' })) as ReactNode}</>);
    expect(third.container.querySelector('a')).toHaveAttribute(
      'href',
      'https://github.com/a/b',
    );
    await expect(GithubInfo({ owner: '..', repo: 'b' })).rejects.toThrow('not a GitHub');
    await expect(GithubInfo({ owner: 'a b', repo: 'b' })).rejects.toThrow('not a GitHub');
    fetchSpy.mockRestore();
  });
});
