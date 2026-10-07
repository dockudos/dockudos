import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checklist, ChecklistItem } from './checklist.tsx';
import { Exercise, Hint, Solution } from './exercise.tsx';
import { Answer, Question, Quiz } from './quiz.tsx';

beforeEach(() => localStorage.clear());

describe('Checklist with an id', () => {
  const list = () => (
    <Checklist id="release">
      <ChecklistItem checked>Tests pass</ChecklistItem>
      <ChecklistItem>Docs updated</ChecklistItem>
    </Checklist>
  );

  it('renders real checkboxes that start from `checked`', () => {
    render(list());
    expect(screen.getByRole('checkbox', { name: 'Tests pass' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Docs updated' }),
    ).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 done');
  });

  it('saves ticks and restores them on the next visit', async () => {
    const user = userEvent.setup();
    const first = render(list());
    await user.click(screen.getByRole('checkbox', { name: 'Docs updated' }));
    await user.click(screen.getByRole('checkbox', { name: 'Tests pass' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 done');
    first.unmount();

    render(list());
    expect(
      await screen.findByRole('checkbox', { name: 'Docs updated' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Tests pass' }),
    ).not.toBeChecked();
  });

  it('Reset goes back to the written state', async () => {
    const user = userEvent.setup();
    render(list());
    await user.click(screen.getByRole('checkbox', { name: 'Docs updated' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      screen.getByRole('checkbox', { name: 'Docs updated' }),
    ).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('without an id stays read-only and writes nothing', () => {
    render(
      <Checklist>
        <ChecklistItem>One</ChecklistItem>
      </Checklist>,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe('Quiz', () => {
  const quiz = () => (
    <Quiz id="intro" title="Check yourself">
      <Question text="Pick the even number" explanation="Two divides it.">
        <Answer>3</Answer>
        <Answer correct>4</Answer>
      </Question>
      <Question text="Which are fruit?">
        <Answer correct>Apple</Answer>
        <Answer>Brick</Answer>
        <Answer correct>Pear</Answer>
      </Question>
    </Quiz>
  );

  it('uses radios for one right answer and checkboxes for several', () => {
    render(quiz());
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Select all that apply.')).toBeInTheDocument();
  });

  it('keeps Check answer disabled until something is chosen, then gives feedback', async () => {
    const user = userEvent.setup();
    render(quiz());
    const [check] = screen.getAllByRole('button', { name: 'Check answer' });
    expect(check).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: '3' }));
    await user.click(check);
    expect(screen.getByText('Not quite.')).toBeInTheDocument();
    expect(screen.getByText('Two divides it.')).toBeVisible();
    expect(screen.getByText(/\(correct answer\)/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /3/ })).toBeDisabled();
  });

  it('scores the quiz, saves it, and Start again clears it', async () => {
    const user = userEvent.setup();
    const first = render(quiz());
    await user.click(screen.getByRole('radio', { name: '4' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Check answer' })[0]!,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pear' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('You got 2 of 2 right.')).toBeInTheDocument();
    first.unmount();

    render(quiz());
    expect(
      await screen.findByText('You got 2 of 2 right.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.queryByText(/right\./)).toBeNull();
    expect(screen.getByRole('radio', { name: '4' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: '4' })).not.toBeChecked();
  });

  it('a partly right multiple choice is wrong', async () => {
    const user = userEvent.setup();
    render(quiz());
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Check answer' })[1]!,
    );
    expect(screen.getByText('Not quite.')).toBeInTheDocument();
  });

  it('a Question outside a Quiz works on its own', async () => {
    const user = userEvent.setup();
    render(
      <Question text="Solo?">
        <Answer correct>Yes</Answer>
        <Answer>No</Answer>
      </Question>,
    );
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('Correct.')).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});

describe('Exercise', () => {
  it('hides hints and the solution in details until asked', async () => {
    const user = userEvent.setup();
    render(
      <Exercise title="Add a page">
        <p>Make one.</p>
        <Hint>Look at the quickstart.</Hint>
        <Solution>Create docs/x.mdx.</Solution>
      </Exercise>,
    );
    expect(screen.getByRole('region', { name: 'Add a page' })).toBeVisible();
    expect(screen.getByText('Create docs/x.mdx.')).not.toBeVisible();
    await user.click(screen.getByText('Solution'));
    expect(screen.getByText('Create docs/x.mdx.')).toBeVisible();
  });
});
