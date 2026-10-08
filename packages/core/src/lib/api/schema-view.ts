import type { ApiSchema } from './types.ts';

/** Finds a named schema. Pages only carry the schemas they show, so this can return `undefined`. */
export type SchemaLookup = (name: string) => ApiSchema | undefined;

/** The schema a reference stands for, or the schema itself. A stub that is not available stays a stub. */
export function resolveSchema(
  schema: ApiSchema,
  lookup: SchemaLookup,
): ApiSchema {
  const seen = new Set<string>();
  let current = schema;
  while (current.ref && !seen.has(current.ref)) {
    // An expanded stub already carries its content.
    if (hasContent(current)) return current;
    seen.add(current.ref);
    const target = lookup(current.ref);
    if (!target) return current;
    current = {
      ...target,
      ...(current.description && { description: current.description }),
      ref: current.ref,
    };
  }
  return current;
}

const CONTENT_KEYS = [
  'type',
  'types',
  'properties',
  'items',
  'oneOf',
  'anyOf',
  'allOf',
  'enum',
  'const',
  'additionalProperties',
] as const;

/** Does the schema say anything about its shape, or is it just a reference? */
export function hasContent(schema: ApiSchema): boolean {
  return CONTENT_KEYS.some((k) => schema[k] !== undefined);
}

/**
 * `allOf` flattened into one schema: the properties and required lists of every part together. Parts that are not
 * available (a reference that was not loaded) are skipped. Other composition (`oneOf`, `anyOf`) is kept as is.
 */
export function mergeAllOf(
  schema: ApiSchema,
  lookup: SchemaLookup,
  depth = 0,
): ApiSchema {
  const resolved = resolveSchema(schema, lookup);
  if (!resolved.allOf || depth > 16) return resolved;
  const { allOf, ...rest } = resolved;
  const merged: ApiSchema = { ...rest };
  for (const part of allOf) {
    const p = mergeAllOf(part, lookup, depth + 1);
    const { ref: _ref, properties, required, ...others } = p;
    if (properties) {
      merged.properties = { ...merged.properties, ...properties };
    }
    if (required) {
      merged.required = [...new Set([...(merged.required ?? []), ...required])];
    }
    for (const [k, v] of Object.entries(others)) {
      const key = k as keyof ApiSchema;
      if (merged[key] === undefined)
        (merged as Record<string, unknown>)[key] = v;
    }
  }
  if (merged.properties && !merged.type) merged.type = 'object';
  return merged;
}

/** A short type label for tables: `string`, `string<uuid>`, `Pet[]`, `integer | null`, `one of`. */
export function typeLabel(schema: ApiSchema | undefined): string {
  if (!schema) return 'any';
  const nullable = schema.nullable ? ' | null' : '';
  if (schema.ref && !hasContent(schema)) return schema.ref + nullable;
  if (schema.type === 'array') {
    const inner = schema.items ? typeLabel(schema.items) : 'any';
    return `${inner.includes(' ') ? `(${inner})` : inner}[]${nullable}`;
  }
  const composed = schema.oneOf
    ? 'one of'
    : schema.anyOf
      ? 'any of'
      : schema.allOf && !schema.type
        ? 'object'
        : undefined;
  if (composed) return composed + nullable;
  const base = schema.types?.join(' | ') ?? schema.type;
  if (!base) {
    if (schema.enum) return 'enum' + nullable;
    if (schema.const !== undefined) return 'const' + nullable;
    return (schema.ref ?? 'any') + nullable;
  }
  return (schema.format ? `${base}<${schema.format}>` : base) + nullable;
}

/** Constraints worth showing next to a field: `min 1`, `max length 20`, `pattern ^a`. */
export function constraints(schema: ApiSchema): string[] {
  const out: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v !== undefined) out.push(`${label} ${String(v)}`);
  };
  add('min', schema.minimum);
  add('max', schema.maximum);
  add('min (exclusive)', schema.exclusiveMinimum);
  add('max (exclusive)', schema.exclusiveMaximum);
  add('multiple of', schema.multipleOf);
  add('min length', schema.minLength);
  add('max length', schema.maxLength);
  add('min items', schema.minItems);
  add('max items', schema.maxItems);
  add('pattern', schema.pattern);
  if (schema.uniqueItems) out.push('unique items');
  return out;
}

const SAMPLE_BY_FORMAT: Record<string, unknown> = {
  'date-time': '2024-01-15T09:30:00Z',
  date: '2024-01-15',
  time: '09:30:00',
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  byte: 'U3dhZ2dlciByb2Nrcw==',
  binary: '(binary)',
  password: '********',
};

export interface ExampleOptions {
  /** How many references deep to follow before leaving a value out. Default 3. */
  depth?: number;
  /** Leave out `readOnly` (for requests) or `writeOnly` (for responses) fields. */
  skip?: 'readOnly' | 'writeOnly';
}

/**
 * A plausible value for a schema: its `example`, else `default`, else the first `enum` value, else something that fits
 * the type and format. Circular schemas end at `depth`.
 */
export function exampleFromSchema(
  schema: ApiSchema | undefined,
  lookup: SchemaLookup,
  options: ExampleOptions = {},
): unknown {
  // A cap on the size of the answer, whatever the schema: circular and heavily linked schemas stay finite.
  const budget = { nodes: 400 };
  return sample(schema, lookup, options.depth ?? 3, options.skip, 0, budget);
}

function sample(
  input: ApiSchema | undefined,
  lookup: SchemaLookup,
  depth: number,
  skip: ExampleOptions['skip'],
  level: number,
  budget: { nodes: number },
): unknown {
  if (!input || level > 24 || --budget.nodes < 0) return null;
  const hops = input.ref && !hasContent(input) ? 1 : 0;
  if (hops && depth <= 0) return input.type === 'array' ? [] : {};
  const schema = mergeAllOf(input, lookup);
  // Merging `allOf` follows references too, so it counts as a step.
  const nextDepth = depth - hops - (input.allOf ? 1 : 0);

  if (schema.examples?.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const choice = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (choice) return sample(choice, lookup, nextDepth, skip, level + 1, budget);

  const type =
    schema.type ??
    schema.types?.[0] ??
    (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        const p = resolveSchema(prop, lookup);
        if (skip && p[skip]) continue;
        out[name] = sample(prop, lookup, nextDepth, skip, level + 1, budget);
      }
      if (
        !Object.keys(out).length &&
        typeof schema.additionalProperties === 'object'
      ) {
        out.key = sample(
          schema.additionalProperties,
          lookup,
          nextDepth,
          skip,
          level + 1,
          budget,
        );
      }
      return out;
    }
    case 'array':
      return schema.items
        ? [sample(schema.items, lookup, nextDepth, skip, level + 1, budget)]
        : [];
    case 'integer':
      return (
        schema.minimum ??
        (schema.exclusiveMinimum !== undefined
          ? schema.exclusiveMinimum + 1
          : 0)
      );
    case 'number':
      return (
        schema.minimum ??
        (schema.exclusiveMinimum !== undefined
          ? schema.exclusiveMinimum + 1
          : 0)
      );
    case 'boolean':
      return true;
    case 'string':
      return (
        (schema.format && SAMPLE_BY_FORMAT[schema.format]) ||
        (schema.minLength
          ? 'x'.repeat(Math.min(schema.minLength, 32))
          : 'string')
      );
    default:
      return null;
  }
}

/**
 * Check what a person typed for a parameter against its schema. Returns what is wrong in a sentence, or
 * `undefined`. Lists are typed as `a,b,c`. An empty value is only wrong when the parameter is required.
 */
export function validateInput(
  schema: ApiSchema | undefined,
  text: string,
  required: boolean,
): string | undefined {
  if (text === '') return required ? 'Required' : undefined;
  if (!schema) return undefined;
  const items =
    schema.type === 'array' ? text.split(',').map((s) => s.trim()) : [text];
  const target = schema.type === 'array' ? (schema.items ?? {}) : schema;
  for (const item of items) {
    const problem = validateOne(target, item);
    if (problem) return problem;
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && items.length < schema.minItems)
      return `At least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && items.length > schema.maxItems)
      return `At most ${schema.maxItems} items`;
  }
  return undefined;
}

function validateOne(schema: ApiSchema, text: string): string | undefined {
  if (schema.enum && !schema.enum.map(String).includes(text)) {
    return `Must be one of: ${schema.enum.map(String).join(', ')}`;
  }
  const type = schema.type ?? schema.types?.[0];
  if (type === 'integer' || type === 'number') {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n))
      return `Must be ${type === 'integer' ? 'an integer' : 'a number'}`;
    if (type === 'integer' && !Number.isInteger(n)) return 'Must be an integer';
    if (schema.minimum !== undefined && n < schema.minimum)
      return `Must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && n > schema.maximum)
      return `Must be at most ${schema.maximum}`;
    if (schema.exclusiveMinimum !== undefined && n <= schema.exclusiveMinimum)
      return `Must be more than ${schema.exclusiveMinimum}`;
    if (schema.exclusiveMaximum !== undefined && n >= schema.exclusiveMaximum)
      return `Must be less than ${schema.exclusiveMaximum}`;
    if (schema.multipleOf && n % schema.multipleOf !== 0)
      return `Must be a multiple of ${schema.multipleOf}`;
  } else if (type === 'boolean') {
    if (text !== 'true' && text !== 'false') return 'Must be true or false';
  } else {
    if (schema.minLength !== undefined && text.length < schema.minLength)
      return `At least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && text.length > schema.maxLength)
      return `At most ${schema.maxLength} characters`;
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(text))
          return `Must match ${schema.pattern}`;
      } catch {
        // a pattern JavaScript cannot read: do not block the request on it
      }
    }
  }
  return undefined;
}
