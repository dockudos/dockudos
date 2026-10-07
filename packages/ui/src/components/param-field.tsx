import type { ReactNode } from 'react';

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
