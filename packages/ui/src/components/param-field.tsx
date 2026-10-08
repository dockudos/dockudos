import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

export interface ParamFieldProps {
  /** The parameter, property or header name. */
  name: string;
  /** Its type, shown as code: `string`, `number[]`, `"asc" | "desc"`. */
  type?: string;
  required?: boolean;
  /** Default value, shown as code. */
  default?: string;
  /** Where it goes: `query`, `path`, `body`, `header`. Shown as a label. */
  location?: string;
  children?: ReactNode;
}

/**
 * One documented parameter: name, type, required and default, then a description.
 * Several in a row make a parameter list for an endpoint, a function or a config file.
 */
export function ParamField({
  name,
  type,
  required,
  default: defaultValue,
  location,
  children,
}: ParamFieldProps) {
  return (
    <div className="dk-param">
      <div className="dk-param-head">
        <code className="dk-param-name">{name}</code>
        {type && <code className="dk-param-type">{type}</code>}
        {location && <span className="dk-param-tag">{location}</span>}
        {required && <span className="dk-param-required">required</span>}
        {defaultValue !== undefined && (
          <span className="dk-param-default">
            default <code>{defaultValue}</code>
          </span>
        )}
      </div>
      {children && <div className="dk-param-body">{children}</div>}
    </div>
  );
}

/** A field of a response or return value. The same as `ParamField`, minus `required` and `location`. */
export function ResponseField({
  name,
  type,
  default: defaultValue,
  children,
}: Omit<ParamFieldProps, 'required' | 'location'>) {
  return (
    <ParamField name={name} type={type} default={defaultValue}>
      {children}
    </ParamField>
  );
}

const field = ((props, children) => {
  const name = ['name', 'path', 'query', 'body', 'header'].map((k) => md.text(props[k])).find(Boolean) ?? '';
  const facts = [
    md.text(props.type),
    props.location && `in ${String(props.location)}`,
    props.required && 'required',
    props.default && `default ${String(props.default)}`,
  ].filter(Boolean);
  return md.section(`${md.bold(md.code(name))}${facts.length ? ` (${facts.join(', ')})` : ''}`, children);
}) satisfies ToMarkdown<Record<string, unknown>>;
ParamField.toMarkdown = field;
ResponseField.toMarkdown = field;
