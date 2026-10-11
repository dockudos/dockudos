'use client';

import { md, type ToMarkdown } from '@dockudos/core';
import {
  Children,
  type ComponentType,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
} from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { Callout } from './callout.tsx';
import { Kbd } from './kbd.tsx';
import { LinkButton } from './hero.tsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/** Components a story can show by name (`<Story of="Badge">`). Add your own with `registerStoryComponents`. */
const registry: Record<string, AnyComponent> = { Badge, Button, Callout, Kbd, LinkButton };

/**
 * Make components available to `<Story of="…">`. Call it from a client module that your MDX components file imports:
 * a story changes props in the browser, so it needs the component itself, not the page's rendered copy of it.
 */
export function registerStoryComponents(components: Record<string, AnyComponent>): void {
  Object.assign(registry, components);
}

/** One knob. A bare value is shorthand: a list is a choice, a boolean a switch, a string or number an input. */
export type StoryControl =
  | boolean
  | string
  | number
  | readonly string[]
  | { type: 'boolean'; default?: boolean; label?: string }
  | { type: 'text'; default?: string; label?: string }
  | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
  | { type: 'select'; options: readonly string[]; default?: string; label?: string };

type Normal =
  | { type: 'boolean'; value: boolean; label: string }
  | { type: 'text'; value: string; label: string }
  | { type: 'number'; value: number; min?: number; max?: number; step?: number; label: string }
  | { type: 'select'; options: readonly string[]; value: string; label: string };

export function normalizeControl(name: string, c: StoryControl): Normal {
  if (typeof c === 'boolean') return { type: 'boolean', value: c, label: name };
  if (typeof c === 'string') return { type: 'text', value: c, label: name };
  if (typeof c === 'number') return { type: 'number', value: c, label: name };
  if (Array.isArray(c)) return { type: 'select', options: c, value: c[0] ?? '', label: name };
  const o = c as Exclude<StoryControl, boolean | string | number | readonly string[]>;
  switch (o.type) {
    case 'boolean':
      return { type: 'boolean', value: o.default ?? false, label: o.label ?? name };
    case 'text':
      return { type: 'text', value: o.default ?? '', label: o.label ?? name };
    case 'number':
      return { ...o, type: 'number', value: o.default ?? 0, label: o.label ?? name };
    case 'select':
      return { type: 'select', options: o.options, value: o.default ?? o.options[0] ?? '', label: o.label ?? name };
  }
}

/** The JSX a reader would write for the current values; props at their default are left out. */
export function storyCode(name: string, values: Record<string, unknown>, initial: Record<string, unknown>): string {
  const props = Object.entries(values)
    .filter(([key, v]) => v !== initial[key] || typeof v === 'boolean' && v)
    .map(([key, v]) =>
      v === true ? key : typeof v === 'string' ? `${key}=${JSON.stringify(v)}` : `${key}={${JSON.stringify(v)}}`,
    );
  return `<${name}${props.length ? ' ' + props.join(' ') : ''} />`;
}

export interface StoryProps {
  /** The knobs, by the name of the prop each one sets on the child. */
  controls: Record<string, StoryControl>;
  /**
   * The component to show, by name: one of the built-in ones or one you passed to `registerStoryComponents`. Its
   * props come from `props` and the knobs; `children` become its content. Without `of`, `children` must be one
   * element, and the knobs set its props (this works for HTML elements and client components only).
   */
  of?: string;
  /** Props that stay as they are. With `of`. */
  props?: Record<string, unknown>;
  children?: ReactNode;
  /** Name for the code line under the preview. Default: the component's name. */
  name?: string;
  title?: string;
}

/**
 * A live example: the component in the middle and a control for each prop, with the JSX for what is shown.
 *
 *     <Story controls={{ variant: ['primary', 'secondary'], disabled: false }}><Button>Save</Button></Story>
 */
export function Story({ controls, children, name, title, of, props: fixed }: StoryProps) {
  const id = useId();
  const normal = Object.entries(controls).map(([key, c]) => [key, normalizeControl(key, c)] as const);
  const initial = Object.fromEntries(normal.map(([key, c]) => [key, c.value]));
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const child = Children.toArray(children).find(isValidElement) as ReactElement<Record<string, unknown>> | undefined;
  const Component = of ? registry[of] : undefined;
  const label =
    name ??
    of ??
    (child && typeof child.type === 'string'
      ? child.type
      : ((child?.type as { displayName?: string; name?: string } | undefined)?.displayName ??
        (child?.type as { name?: string } | undefined)?.name ??
        'Component'));

  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  return (
    <figure className="dk-story" aria-label={title}>
      <div className="dk-story-stage">
        {of ? (
          Component ? (
            createElement(Component, { ...fixed, ...values }, children)
          ) : (
            <p role="alert">{`Story: no component named "${of}". Register it with registerStoryComponents().`}</p>
          )
        ) : child ? (
          cloneElement(child, values)
        ) : (
          children
        )}
      </div>
      {normal.length > 0 && (
        <div className="dk-story-controls" data-print="hide">
          {normal.map(([key, c]) => {
            const inputId = `${id}-${key}`;
            return (
              <label key={key} htmlFor={inputId}>
                <span>{c.label}</span>
                {c.type === 'boolean' && (
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={values[key] as boolean}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                )}
                {c.type === 'text' && (
                  <input id={inputId} type="text" value={values[key] as string} onChange={(e) => set(key, e.target.value)} />
                )}
                {c.type === 'number' && (
                  <input
                    id={inputId}
                    type="number"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={values[key] as number}
                    onChange={(e) => set(key, e.target.value === '' ? 0 : Number(e.target.value))}
                  />
                )}
                {c.type === 'select' && (
                  <select id={inputId} value={values[key] as string} onChange={(e) => set(key, e.target.value)}>
                    {c.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            );
          })}
        </div>
      )}
      <pre className="dk-story-code">
        <code>{storyCode(label, values, initial)}</code>
      </pre>
    </figure>
  );
}

Story.toMarkdown = ((props, children) =>
  md.section(
    md.text(props.title),
    [
      children,
      Object.keys(props.controls ?? {}).length
        ? `Props you can change: ${Object.keys(props.controls).map(md.code).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )) satisfies ToMarkdown<{ title?: string; controls: Record<string, unknown> }>;
