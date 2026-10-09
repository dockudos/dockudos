import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { Answer, Question, Quiz } from './quiz.tsx';
import { Prompt } from './prompt.tsx';
import { Stat, Stats } from './stats.tsx';
import { Tile } from './tile.tsx';
import { Checkpoint, TutorialIntro } from './tutorial.tsx';
import { TypeTable } from './type-table.tsx';
import { Update } from './update.tsx';
import { View } from './view.tsx';

type Twin = (props: Record<string, unknown>, children: string) => string | undefined;
const twin = (c: unknown) => (c as { toMarkdown: Twin }).toMarkdown;

beforeEach(() => localStorage.clear());

describe('quiz', () => {
  it('Answer renders nothing by itself', () => {
    expect(Answer({})).toBeNull();
  });

  it('lets a multiple-choice question be unticked, and tried again on its own', async () => {
    const user = userEvent.setup();
    render(
      <Question text="Pick">
        <Answer correct>A</Answer>
        <Answer correct>B</Answer>
        <Answer>C</Answer>
      </Question>,
    );
    await user.click(screen.getByLabelText('A'));
    await user.click(screen.getByLabelText('B'));
    await user.click(screen.getByLabelText('A'));
    expect(screen.getByLabelText('A')).not.toBeChecked();
    await user.click(screen.getByLabelText('A'));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('Correct.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();
  });

  it('a quiz with no title is just a quiz, and counts what was right', async () => {
    const user = userEvent.setup();
    render(
      <Quiz>
        <Question text="One">
          <Answer correct>Yes</Answer>
          <Answer>No</Answer>
        </Question>
      </Quiz>,
    );
    expect(screen.getByRole('region', { name: 'Quiz' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('No'));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('You got 0 of 1 right.')).toBeInTheDocument();
  });

  it('as Markdown', () => {
    expect(twin(Quiz)({ title: 'T' }, 'x')).toContain('Quiz: T');
    expect(twin(Quiz)({}, 'x')).toContain('**Quiz**');
    expect(twin(Question)({ text: 'Q', explanation: 'Because' }, 'x')).toContain('Explanation: Because');
    expect(twin(Question)({ text: 'Q' }, 'x')).not.toContain('Explanation');
    expect(twin(Answer)({ correct: true }, ' A ')).toContain('A (correct)');
    expect(twin(Answer)({}, 'B')).not.toContain('correct');
  });
});

describe('tutorial', () => {
  it('shows only what it was given', () => {
    const { container } = render(<TutorialIntro>Hello</TutorialIntro>);
    expect(container.querySelector('.dk-tutorial-meta')).toBeNull();
    const second = render(<TutorialIntro level="Easy" learn={[]} requires={[]} />);
    expect(second.container.textContent).toContain('Easy');
    expect(second.container.querySelector('ul')).toBeNull();
  });

  it('as Markdown', () => {
    const intro = twin(TutorialIntro)(
      { time: '5 min', level: 'Easy', learn: ['A'], requires: ['B'] },
      'x',
    );
    expect(intro).toContain('5 min');
    expect(intro).toContain('**You will learn:**');
    expect(intro).toContain('**Requires:**');
    expect(twin(TutorialIntro)({}, 'x')).toBeTypeOf('string');
    expect(twin(Checkpoint)({ title: 'Look' }, 'x')).toContain('Look');
    expect(twin(Checkpoint)({}, 'x')).toContain('**Checkpoint**');
  });
});

describe('type table', () => {
  it('shows a description, a default, and what is required', () => {
    render(
      <TypeTable
        type={{
          a: { type: 'string', description: 'The a', default: 'x', required: true },
          b: { type: 'number' },
        }}
      />,
    );
    expect(screen.getByText('The a')).toBeInTheDocument();
    expect(screen.getByLabelText('none')).toBeInTheDocument();
  });

  it('as Markdown: with and without a type, a default, a description, or fields at all', () => {
    const md = twin(TypeTable)(
      { type: { a: { type: 'string', default: 0, required: true, description: 'D' }, b: {} } },
      '',
    );
    expect(md).toContain('(required)');
    expect(md).toContain('`0`');
    expect(twin(TypeTable)({}, '')).toBeUndefined();
    expect(twin(TypeTable)({ type: 'nope' }, '')).toBeUndefined();
  });
});

describe('small blocks', () => {
  it('stats in two and four columns', () => {
    const cls = (cols: 2 | 4) => {
      const { container, unmount } = render(
        <Stats cols={cols}>
          <Stat label="A" value="1" description="d" />
        </Stats>,
      );
      const c = container.firstElementChild?.className ?? '';
      unmount();
      return c;
    };
    expect(cls(2)).toContain('sm:grid-cols-2');
    expect(cls(4)).toContain('lg:grid-cols-4');
    expect(screen.queryByText('d')).toBeNull();
  });

  it('a tile without a link is a plain block', () => {
    const { container } = render(<Tile title="T" description="D" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('D');
  });

  it('an update with a description', () => {
    render(<Update label="1.0" date="soon" description="Big one" tags={[]} />);
    expect(screen.getByText('Big one')).toBeInTheDocument();
    expect(screen.getByText('soon')).toBeInTheDocument();
  });
});

describe('prompt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies the text of a prompt that is not plain text, opens it in Cursor, and says when copying failed', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no'));
    render(
      <Prompt description="Do it" actions={['copy', 'cursor', 'nonsense' as 'copy']} icon="rocket">
        <b>Write </b>tests
      </Prompt>,
    );
    await user.click(screen.getByRole('button', { name: /Open in Cursor/ }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('Write tests')),
      '_blank',
      'noopener,noreferrer',
    );
    await user.click(screen.getByRole('button', { name: /Copy prompt/ }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });
});

describe('view', () => {
  it('renders on the server, shows every view, and has an icon and a twin', () => {
    expect(renderToString(<View title="npm">x</View>)).toContain('npm');
    expect(twin(View)({ title: 'pnpm' }, 'body')).toContain('**pnpm**');
  });

  it('starts from the remembered view only for the first one, and survives blocked storage', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { container } = render(
        <>
          <View title="One" icon="rocket">
            first
          </View>
          <View title="Two">second</View>
        </>,
      );
      const select = screen.getByRole('combobox');
      act(() => {
        fireEvent.change(select, { target: { value: 'Two' } });
      });
      expect(container.querySelector('[data-view="One"]')).toHaveStyle({
        display: 'none',
      });
    } finally {
      blocked.mockRestore();
      setter.mockRestore();
    }
  });

  it('keeps the choice already made when another view appears later', () => {
    const { container } = render(
      <>
        <View title="One">first</View>
        <View title="Two">second</View>
      </>,
    );
    // An earlier test chose "Two"; it is still the one shown.
    expect(container.querySelector('[data-view="One"]')).toHaveStyle({ display: 'none' });
  });
});
