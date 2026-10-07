import { Clock, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import { Expandable } from './expandable.tsx';
import { renderIcon } from './render-icon.tsx';

export interface TutorialIntroProps {
  /** How long it takes: `20 minutes`. */
  time?: string;
  /** Who it is for: `Beginner`. */
  level?: string;
  /** What the reader will be able to do afterwards. */
  learn?: string[];
  /** What the reader needs first. Strings, or elements such as links. */
  requires?: ReactNode[];
  children?: ReactNode;
}

/** The top of a tutorial: time, level, what you will learn and what you need first. */
export function TutorialIntro({
  time,
  level,
  learn,
  requires,
  children,
}: TutorialIntroProps) {
  return (
    <section className="dk-tutorial-intro" aria-label="About this tutorial">
      {(time || level) && (
        <p className="dk-tutorial-meta">
          {time && (
            <span>
              <Clock className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Time: </span>
              {time}
            </span>
          )}
          {level && (
            <span>
              <Gauge className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Level: </span>
              {level}
            </span>
          )}
        </p>
      )}
      {children}
      {learn && learn.length > 0 && (
        <>
          <h2 className="dk-tutorial-heading">What you will learn</h2>
          <ul>
            {learn.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {requires && requires.length > 0 && (
        <>
          <h2 className="dk-tutorial-heading">Before you start</h2>
          <ul>
            {requires.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export interface CheckpointProps {
  /** Default "Check your work". */
  title?: string;
  children?: ReactNode;
}

/** A place to stop and check: what the reader should see before going on. */
export function Checkpoint({
  title = 'Check your work',
  children,
}: CheckpointProps) {
  return (
    <aside className="dk-checkpoint" aria-label={title}>
      <p className="dk-checkpoint-title">
        {renderIcon('circle-check', 16)}
        {title}
      </p>
      <div>{children}</div>
    </aside>
  );
}

export interface HintProps {
  /** Default "Hint". */
  title?: string;
  children?: ReactNode;
}

/** A nudge, hidden until asked for, so a reader can try first. */
export function Hint({ title = 'Hint', children }: HintProps) {
  return <Expandable title={title}>{children}</Expandable>;
}

/** The answer, hidden until asked for. Opened on paper. */
export function Solution({ title = 'Solution', children }: HintProps) {
  return <Expandable title={title}>{children}</Expandable>;
}
