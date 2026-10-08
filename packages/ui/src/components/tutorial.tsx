import { Clock, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout } from './callout.tsx';
import { md, type ToMarkdown } from '@dockudos/core';

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

/** A place to stop and check: what the reader should see before going on. A `Callout` of type `check`. */
export function Checkpoint({
  title = 'Check your work',
  children,
}: CheckpointProps) {
  return (
    <Callout type="check" title={title}>
      {children}
    </Callout>
  );
}

TutorialIntro.toMarkdown = ((props, children) => {
  const learn = md.list(props.learn);
  const requires = md.list(props.requires);
  const facts = [props.time && `Time: ${props.time}`, props.level && `Level: ${props.level}`].filter(Boolean).join(' · ');
  return md.section(
    [
      facts,
      learn.length && `${md.bold('You will learn:')}\n${learn.map((l) => `- ${l}`).join('\n')}`,
      requires.length && `${md.bold('Requires:')}\n${requires.map((l) => `- ${l}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    children,
  );
}) satisfies ToMarkdown<{ time?: string; level?: string; learn?: string[]; requires?: string[] }>;
Checkpoint.toMarkdown = ((props, children) =>
  md.section(md.bold(props.title ? `Checkpoint: ${props.title}` : 'Checkpoint'), children)) satisfies ToMarkdown<{
  title?: string;
}>;
