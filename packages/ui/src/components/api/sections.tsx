'use client';

import {
  type ApiMediaType,
  type ApiParameter,
  type ParameterLocation,
  constraints,
  typeLabel,
} from '@dockudos/core';
import { CopyButton } from '../copy-button.tsx';
import { ParamField } from '../param-field.tsx';
import { Tab } from '../tab-panel.tsx';
import { Tabs } from '../tabs.tsx';
import { useApiOperation } from './context.tsx';
import { Prose } from './prose.tsx';
import { SchemaTree } from './schema.tsx';

/** Code as it is: a frame with a copy button. Samples are generated in the browser, so they are not highlighted. */
export function CodeFigure({ code, title }: { code: string; title?: string }) {
  return (
    <figure className="dk-code" data-has-title={title ? '' : undefined}>
      {title && <figcaption className="dk-code-title">{title}</figcaption>}
      <div className="dk-code-body">
        <pre className="dk-pre" tabIndex={0}>
          <code>{code}</code>
        </pre>
        <CopyButton />
      </div>
    </figure>
  );
}

const LOCATIONS: ParameterLocation[] = ['path', 'query', 'header', 'cookie'];

function ParameterRow({ p }: { p: ApiParameter }) {
  const schema = p.schema;
  const facts = [...(schema ? constraints(schema) : [])];
  const enumValues = schema?.enum ?? schema?.items?.enum;
  return (
    <ParamField
      name={p.name}
      type={typeLabel(schema)}
      required={p.required}
      location={p.in}
      default={schema?.default !== undefined ? JSON.stringify(schema.default) : undefined}
    >
      {p.deprecated && <p className="dk-api-facts">Deprecated.</p>}
      <Prose text={p.description ?? schema?.description} />
      {enumValues && (
        <p className="dk-api-enum">
          One of:{' '}
          {enumValues.map((v, i) => (
            <code key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</code>
          ))}
        </p>
      )}
      {p.example !== undefined && (
        <p className="dk-api-enum">
          Example <code>{typeof p.example === 'string' ? p.example : JSON.stringify(p.example)}</code>
        </p>
      )}
      {facts.length > 0 && <p className="dk-api-facts">{facts.join(' · ')}</p>}
    </ParamField>
  );
}

/** The parameters of the operation, by where they go: path, query, header, cookie. */
export function ApiParameters() {
  const { data } = useApiOperation();
  const { parameters } = data.operation;
  return (
    <div className="dk-api-params">
      {LOCATIONS.map((where) => {
        const items = parameters.filter((p) => p.in === where);
        if (!items.length) return null;
        return (
          <section key={where} aria-label={`${where} parameters`}>
            <h3 className="dk-api-subhead">{where[0]?.toUpperCase()}{where.slice(1)} parameters</h3>
            {items.map((p) => (
              <ParameterRow key={`${p.in}:${p.name}`} p={p} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Media({ mime, media }: { mime: string; media: ApiMediaType }) {
  const examples = Object.entries(media.examples);
  return (
    <div className="dk-api-media">
      {media.schema && <SchemaTree schema={media.schema} />}
      {examples.map(([name, example]) => (
        <CodeFigure
          key={name}
          title={example.summary ?? (examples.length > 1 ? name : 'Example')}
          code={typeof example.value === 'string' ? example.value : JSON.stringify(example.value, null, 2)}
        />
      ))}
      {!media.schema && examples.length === 0 && <p className="dk-api-status">No schema is given for {mime}.</p>}
    </div>
  );
}

function MediaTabs({ content, group }: { content: Record<string, ApiMediaType>; group: string }) {
  const entries = Object.entries(content);
  if (entries.length === 1) {
    const [mime, media] = entries[0] as [string, ApiMediaType];
    return (
      <>
        <p className="dk-api-mime">
          Content type <code>{mime}</code>
        </p>
        <Media mime={mime} media={media} />
      </>
    );
  }
  return (
    <Tabs items={entries.map(([mime]) => mime)} groupId={group}>
      {entries.map(([mime, media]) => (
        <Tab key={mime} value={mime}>
          <Media mime={mime} media={media} />
        </Tab>
      ))}
    </Tabs>
  );
}

/** The request body: its description, and its schema and example for each content type. */
export function ApiRequestBody() {
  const { data } = useApiOperation();
  const body = data.operation.requestBody;
  if (!body) return null;
  return (
    <div className="dk-api-body">
      {body.required && <p className="dk-param-required">required</p>}
      <Prose text={body.description} />
      <MediaTabs content={body.content} group="api-request-content-type" />
    </div>
  );
}

/** The responses, one tab for each status. */
export function ApiResponses() {
  const { data } = useApiOperation();
  const { responses } = data.operation;
  if (!responses.length) return null;
  return (
    <div className="dk-api-responses">
      <Tabs items={responses.map((r) => r.status)}>
        {responses.map((r) => (
          <Tab key={r.status} value={r.status}>
            <Prose text={r.description} />
            {r.headers.length > 0 && (
              <>
                <h3 className="dk-api-subhead">Headers</h3>
                {r.headers.map((h) => (
                  <ParamField key={h.name} name={h.name} type={typeLabel(h.schema)} location="header">
                    <Prose text={h.description} />
                  </ParamField>
                ))}
              </>
            )}
            {Object.keys(r.content).length > 0 ? (
              <MediaTabs content={r.content} group="api-response-content-type" />
            ) : (
              <p className="dk-api-status">No body.</p>
            )}
          </Tab>
        ))}
      </Tabs>
    </div>
  );
}
