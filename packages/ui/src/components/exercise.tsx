import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ExerciseProps {
  /** What the reader is asked to do, in a few words. */
  title?: string;
  /** The task, then any `Hint` and `Solution`. */
  children?: ReactNode;
}

/** A task for the reader to try, with hints and a solution they can reveal. */
export function Exercise({ title = 'Exercise', children }: ExerciseProps) {
  return (
    <section className="dk-exercise" aria-label={title}>
      <p className="dk-exercise-title">{title}</p>
      {children}
    </section>
  );
}

export interface RevealProps {
  /** Default "Hint" or "Solution". */
  title?: string;
  children?: ReactNode;
}

function Reveal({
  kind,
  title,
  children,
}: RevealProps & { kind: 'hint' | 'solution' }) {
  return (
    <details className={`dk-reveal dk-reveal-${kind}`}>
      <summary>
        <ChevronRight className="dk-reveal-chevron" aria-hidden="true" />
        {title ?? (kind === 'hint' ? 'Hint' : 'Solution')}
      </summary>
      <div className="dk-reveal-body">{children}</div>
    </details>
  );
}

/** A nudge, hidden until the reader asks. Native `<details>`: it works without JavaScript. */
export const Hint = (props: RevealProps) => <Reveal kind="hint" {...props} />;

/** The answer to an `Exercise`, hidden until the reader asks. */
export const Solution = (props: RevealProps) => (
  <Reveal kind="solution" {...props} />
);
