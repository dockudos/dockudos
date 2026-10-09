'use client';

import {
  type ApiSchema,
  constraints,
  hasContent,
  mergeAllOf,
  typeLabel,
} from '@dockudos/core';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils.ts';
import { useApiOperation } from './context.tsx';
import { Prose } from './prose.tsx';
import { loadSchema, loadedSchema } from './store.ts';

const MAX_DEPTH = 12;

type Loaded =
  | { status: 'ready'; schema: ApiSchema }
  | { status: 'loading' }
  | { status: 'error'; message: string };

/**
 * The schema with the references needed to show it loaded: itself if it is a reference, and the parts of an `allOf`,
 * which are merged. Properties stay references until the reader opens them.
 */
function useResolved(schema: ApiSchema, baseUrl: string, enabled: boolean): Loaded {
  const [, bump] = useState(0);
  const [error, setError] = useState<string>();

  const lookup = (name: string) => loadedSchema(baseUrl, name);
  const missing = enabled ? missingRefs(schema, lookup) : [];
  const key = missing.join('\0');

  useEffect(() => {
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map((name) => loadSchema(baseUrl, name))).then(
      () => !cancelled && bump((n) => n + 1),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
    // `key` stands for `missing`
  }, [key, baseUrl]);

  if (error) return { status: 'error', message: error };
  if (missing.length) return { status: 'loading' };
  return { status: 'ready', schema: mergeAllOf(schema, lookup) };
}

/** Names of schemas that must be loaded before this one can be shown merged. */
function missingRefs(
  schema: ApiSchema,
  lookup: (name: string) => ApiSchema | undefined,
  seen = new Set<string>(),
): string[] {
  const out: string[] = [];
  const visit = (s: ApiSchema) => {
    let current = s;
    if (current.ref && !hasContent(current)) {
      if (seen.has(current.ref)) return;
      seen.add(current.ref);
      const found = lookup(current.ref);
      if (!found) {
        out.push(current.ref);
        return;
      }
      current = found;
    }
    for (const part of current.allOf ?? []) visit(part);
  };
  visit(schema);
  return out;
}

const isStub = (s: ApiSchema) => !!s.ref && !hasContent(s);

const hasChildren = (s: ApiSchema): boolean =>
  !!s.properties ||
  typeof s.additionalProperties === 'object' ||
  !!s.oneOf ||
  !!s.anyOf ||
  (s.type === 'array' && !!s.items && (hasChildren(s.items) || isStub(s.items)));

export interface SchemaTreeProps {
  schema: ApiSchema;
}

/** A schema as a tree of fields. A field that is a reference loads when opened. Circular schemas stop where they repeat. */
export function SchemaTree({ schema }: SchemaTreeProps) {
  return (
    <div className="dk-api-schema">
      <SchemaNode schema={schema} ancestors={[]} depth={0} defaultOpen root />
    </div>
  );
}

interface NodeProps {
  name?: string;
  schema: ApiSchema;
  required?: boolean;
  ancestors: string[];
  depth: number;
  defaultOpen?: boolean;
  root?: boolean;
}

function SchemaNode({ name, schema, required, ancestors, depth, defaultOpen = false, root }: NodeProps) {
  const { schemasUrl } = useApiOperation();
  const [open, setOpen] = useState(defaultOpen);
  const circular = !!schema.ref && ancestors.includes(schema.ref);
  // Only look inside once it is open, so a big tree does not load everything at once.
  const loaded = useResolved(schema, schemasUrl, open && !circular);
  const shown = loaded.status === 'ready' ? loaded.schema : schema;
  const expandable = !circular && depth < MAX_DEPTH && (hasChildren(shown) || isStub(schema));
  const label = schema.ref && hasContent(schema) ? schema.ref : typeLabel(schema);
  const description = shown.description ?? schema.description;
  const facts = [...constraints(shown), ...(shown.format && !label.includes('<') ? [`format ${shown.format}`] : [])];

  return (
    <div className={cn('dk-api-field', root && 'dk-api-field-root')}>
      {!root && (
        <>
          <div className="dk-api-field-head">
            {expandable ? (
              <button type="button" className="dk-api-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <ChevronRight className="dk-api-chevron" aria-hidden="true" />
                <code className="dk-param-name">{name}</code>
              </button>
            ) : (
              <code className="dk-param-name">{name}</code>
            )}
            <code className="dk-param-type">{label}</code>
            {required && <span className="dk-param-required">required</span>}
            {shown.readOnly && <span className="dk-param-tag">read only</span>}
            {shown.writeOnly && <span className="dk-param-tag">write only</span>}
            {shown.deprecated && <span className="dk-param-tag">deprecated</span>}
            {circular && <span className="dk-param-tag">recursive</span>}
          </div>
          <div className="dk-api-field-body">
            {description && <Prose text={description} />}
            {shown.enum && (
              <p className="dk-api-enum">
                One of:{' '}
                {shown.enum.map((v, i) => (
                  <code key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</code>
                ))}
              </p>
            )}
            {shown.const !== undefined && (
              <p className="dk-api-enum">
                Always <code>{JSON.stringify(shown.const)}</code>
              </p>
            )}
            {shown.default !== undefined && (
              <p className="dk-api-enum">
                Default <code>{JSON.stringify(shown.default)}</code>
              </p>
            )}
            {facts.length > 0 && <p className="dk-api-facts">{facts.join(' · ')}</p>}
          </div>
        </>
      )}
      {root && !expandable && (
        <p className="dk-api-field-body">
          <code className="dk-param-type">{label}</code> {description}
        </p>
      )}
      {expandable && open && (
        <div className={cn('dk-api-children', root && 'dk-api-children-root')}>
          {loaded.status === 'loading' && <p className="dk-api-status">Loading…</p>}
          {loaded.status === 'error' && (
            <p className="dk-api-status" role="alert">
              Could not load this schema ({loaded.message}).
            </p>
          )}
          {loaded.status === 'ready' && (
            <Children schema={shown} ancestors={schema.ref ? [...ancestors, schema.ref] : ancestors} depth={depth + 1} />
          )}
        </div>
      )}
    </div>
  );
}

function Children({ schema, ancestors, depth }: { schema: ApiSchema; ancestors: string[]; depth: number }) {
  // An array of objects shows the object's fields.
  if (schema.type === 'array' && schema.items) {
    return <ItemChildren items={schema.items} ancestors={ancestors} depth={depth} />;
  }
  const variants = schema.oneOf ?? schema.anyOf;
  return (
    <>
      {schema.properties &&
        Object.entries(schema.properties).map(([key, prop]) => (
          <SchemaNode
            key={key}
            name={key}
            schema={prop}
            required={schema.required?.includes(key)}
            ancestors={ancestors}
            depth={depth}
          />
        ))}
      {typeof schema.additionalProperties === 'object' && (
        <SchemaNode name="[key: string]" schema={schema.additionalProperties} ancestors={ancestors} depth={depth} />
      )}
      {variants && (
        <Variants
          kind={schema.oneOf ? 'One of' : 'Any of'}
          variants={variants}
          discriminator={schema.discriminator?.propertyName}
          ancestors={ancestors}
          depth={depth}
        />
      )}
    </>
  );
}

/** The item type of an array: its fields when it is an object. */
function ItemChildren({ items, ancestors, depth }: { items: ApiSchema; ancestors: string[]; depth: number }) {
  const { schemasUrl } = useApiOperation();
  const circular = !!items.ref && ancestors.includes(items.ref);
  const loaded = useResolved(items, schemasUrl, !circular);
  if (circular) {
    return (
      <p className="dk-api-status">
        Each item is a <code>{items.ref}</code> again.
      </p>
    );
  }
  if (loaded.status === 'loading') return <p className="dk-api-status">Loading…</p>;
  if (loaded.status === 'error') {
    return (
      <p className="dk-api-status" role="alert">
        Could not load the item type ({loaded.message}).
      </p>
    );
  }
  return <Children schema={loaded.schema} ancestors={items.ref ? [...ancestors, items.ref] : ancestors} depth={depth} />;
}

function Variants({
  kind,
  variants,
  discriminator,
  ancestors,
  depth,
}: {
  kind: string;
  variants: ApiSchema[];
  discriminator?: string;
  ancestors: string[];
  depth: number;
}) {
  const [selected, setSelected] = useState(0);
  const current = variants[selected];
  // Only an empty list has nothing to show.
  if (!current) return null;
  const labels = variants.map((v, i) => v.title ?? v.ref ?? `${typeLabel(v)} ${i + 1}`);
  return (
    <div className="dk-api-variants">
      <p className="dk-api-facts">
        {kind}
        {discriminator && (
          <>
            , chosen by <code>{discriminator}</code>
          </>
        )}
      </p>
      <div className="dk-api-variant-tabs" role="group" aria-label={kind}>
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
            className="dk-api-variant"
          >
            {label}
          </button>
        ))}
      </div>
      <SchemaNode key={selected} schema={current} ancestors={ancestors} depth={depth} defaultOpen root />
    </div>
  );
}
