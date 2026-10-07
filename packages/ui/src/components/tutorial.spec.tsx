import { render, screen } from '@testing-library/react';
import { TutorialHeader } from '../layout/tutorial-header.tsx';
import { Checkpoint, Hint, TutorialIntro } from './tutorial.tsx';

describe('tutorial components', () => {
  it('TutorialIntro lists time, what you learn and what you need', () => {
    render(
      <TutorialIntro
        time="10 minutes"
        level="Beginner"
        learn={['Build a site']}
        requires={['Node.js']}
      />,
    );
    expect(screen.getByText('10 minutes')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'What you will learn' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
  });

  it('Checkpoint is a titled aside', () => {
    render(<Checkpoint>It runs.</Checkpoint>);
    expect(
      screen.getByRole('complementary', { name: 'Check your work' }),
    ).toHaveTextContent('It runs.');
  });

  it('Hint hides its content in a collapsible block', () => {
    render(<Hint>Try the file name.</Hint>);
    expect(screen.getByText('Hint')).toBeInTheDocument();
  });

  it('TutorialHeader shows the step and a progress bar', () => {
    render(
      <TutorialHeader
        title="Build it"
        step={2}
        steps={[
          { path: '/a', title: 'A' },
          { path: '/b', title: 'B' },
          { path: '/c', title: 'C' },
        ]}
      />,
    );
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByRole('link', { name: /B/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});
