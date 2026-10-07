import { Check, Circle } from 'lucide-react';
import type { ReactNode } from 'react';

/** A list of things to do or to check: a release checklist, a requirements list. */
export function Checklist({ children }: { children: ReactNode }) {
  return <ul className="dk-checklist">{children}</ul>;
}

export interface ChecklistItemProps {
  /** Done or satisfied. Default false. */
  checked?: boolean;
  children?: ReactNode;
}

export function ChecklistItem({ checked = false, children }: ChecklistItemProps) {
  return (
    <li className="dk-checklist-item" data-checked={checked ? '' : undefined}>
      <span className="dk-checklist-box" aria-hidden="true">
        {checked ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
      </span>
      <span className="sr-only">{checked ? 'Done: ' : 'Not done: '}</span>
      <div>{children}</div>
    </li>
  );
}
