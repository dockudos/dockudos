'use client';

import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLink } from '../provider.tsx';

export interface TutorialHeaderProps {
  /** The tutorial's title. */
  title: string;
  /** 1-based number of the current step. */
  step: number;
  steps: readonly { path: string; title: string }[];
}

const key = (title: string) => `dockudos-tutorial:${title}`;

/**
 * Where the reader is in a tutorial: "Step 2 of 5", a progress bar, and a link to every step.
 * Steps the reader has opened are ticked, remembered in the browser.
 */
export function TutorialHeader({ title, step, steps }: TutorialHeaderProps) {
  const Link = useLink();
  const [visited, setVisited] = useState<string[]>([]);
  const current = steps[step - 1]?.path;

  useEffect(() => {
    if (!current) return;
    let seen: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(key(title)) ?? '[]');
      seen = Array.isArray(raw)
        ? raw.filter((p): p is string => typeof p === 'string')
        : [];
    } catch {
      // storage unavailable: progress lasts for this page view only
    }
    const next = seen.includes(current) ? seen : [...seen, current];
    setVisited(next);
    try {
      localStorage.setItem(key(title), JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [title, current]);

  const done = steps.filter(
    (s, i) => i + 1 !== step && visited.includes(s.path),
  ).length;

  return (
    <nav className="dk-tutorial" aria-label={`${title}, tutorial steps`}>
      <p className="dk-tutorial-kicker">
        Tutorial <span aria-hidden="true">·</span> {title}
      </p>
      <p className="dk-tutorial-step">
        Step {step} of {steps.length}
        {done > 0 && (
          <span className="dk-tutorial-done"> · {done} finished earlier</span>
        )}
      </p>
      <div
        className="dk-tutorial-bar"
        role="progressbar"
        aria-label="Tutorial progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of ${steps.length}`}
      >
        <span style={{ width: `${(step / steps.length) * 100}%` }} />
      </div>
      <ol className="dk-tutorial-steps" data-print="hide">
        {steps.map((s, i) => {
          const isCurrent = i + 1 === step;
          const seen = !isCurrent && visited.includes(s.path);
          return (
            <li key={s.path}>
              <Link
                href={s.path}
                aria-current={isCurrent ? 'step' : undefined}
                data-seen={seen ? '' : undefined}
                title={s.title}
              >
                {seen ? <Check className="size-3" aria-hidden="true" /> : i + 1}
                <span className="sr-only">
                  {' '}
                  {s.title}
                  {seen ? ' (visited)' : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
