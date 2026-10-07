import { render, screen } from '@testing-library/react';
import { Checklist, ChecklistItem } from './checklist.tsx';
import { Download } from './download.tsx';
import { Quote } from './quote.tsx';
import { Stat, Stats } from './stats.tsx';
import { ThemedImage } from './themed-image.tsx';
import { Timeline, TimelineItem } from './timeline.tsx';
import { Deprecated, Since } from './version-labels.tsx';

describe('writer helpers', () => {
  it('ThemedImage renders both versions with one alt', () => {
    render(<ThemedImage light="/l.png" dark="/d.png" alt="Screenshot" />);
    const imgs = screen.getAllByAltText('Screenshot');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      '/l.png',
      '/d.png',
    ]);
  });

  it('Since and Deprecated say it in words', () => {
    render(
      <>
        <Since version="1.4" />
        <Deprecated since="2.0" replacedBy="newThing()" />
      </>,
    );
    expect(screen.getByText('Since 1.4')).toBeInTheDocument();
    expect(screen.getByText('Deprecated in 2.0')).toBeInTheDocument();
    expect(screen.getByText('newThing()')).toBeInTheDocument();
  });

  it('Quote credits its author as a link', () => {
    render(
      <Quote author="Ada" source="CTO" href="https://x.dev">
        Great docs.
      </Quote>,
    );
    expect(screen.getByRole('link', { name: 'Ada, CTO' })).toHaveAttribute(
      'href',
      'https://x.dev',
    );
  });

  it('Stats is a description list', () => {
    render(
      <Stats>
        <Stat label="Uptime" value="99.99%" description="Last 90 days" />
      </Stats>,
    );
    expect(screen.getByText('Uptime').tagName).toBe('DT');
    expect(screen.getByText('99.99%').tagName).toBe('DD');
  });

  it('Timeline labels the status in words', () => {
    render(
      <Timeline>
        <TimelineItem title="Beta" date="Q2" status="current" />
      </Timeline>,
    );
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('Download names the type and size and sets download', () => {
    render(
      <Download href="/files/guide.pdf" size="2 MB">
        The guide
      </Download>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveTextContent('(PDF, 2 MB)');
  });

  it('Checklist items say whether they are done', () => {
    render(
      <Checklist>
        <ChecklistItem checked>Tests pass</ChecklistItem>
        <ChecklistItem>Docs updated</ChecklistItem>
      </Checklist>,
    );
    expect(screen.getByText(/Done:/)).toBeInTheDocument();
    expect(screen.getByText(/Not done:/)).toBeInTheDocument();
  });
});
