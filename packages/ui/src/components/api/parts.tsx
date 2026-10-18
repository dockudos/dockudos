'use client';

import { type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';
import { CopyButton } from '../copy-button.tsx';
import { CodeEditor, languageForMime } from './code-editor.tsx';
import { type PlaygroundResponse, formatBody } from './send.ts';

/**
 * The parts the endpoint playground and the API client both use: the tab row and its panels, a labelled field, and the
 * view of a response. They live here so the two keep the same keyboard behaviour and the same look.
 */

export interface TabSpec {
  id: string;
  label: string;
  count?: number;
  /** Something has been entered. */
  flag?: boolean;
  /** Something here needs fixing. */
  bad?: boolean;
}

/** A row of tabs (arrow keys move between them). The caller renders the panels with `Pane`. */
export function PaneTabs({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: TabSpec[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idBase: string;
}) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to =
      e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length] as TabSpec;
    onChange(next.id);
    document.getElementById(`${idBase}-tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="dk-api-tabs">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          data-bad={tab.bad ? '' : undefined}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="dk-api-tab-count">{tab.count}</span>}
          {tab.flag && <span className="dk-api-tab-dot" role="img" aria-label="has content" />}
        </button>
      ))}
    </div>
  );
}

/** The panel of a tab. Every panel stays mounted, so what was typed is kept. */
export function Pane({ id, active, idBase, children }: { id: string; active: string; idBase: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${id}`}
      aria-labelledby={`${idBase}-tab-${id}`}
      hidden={id !== active}
      className="dk-api-pane"
    >
      {children}
    </div>
  );
}

export function FieldInput({
  label,
  value,
  onChange,
  error,
  id,
  placeholder,
  type = 'text',
  description,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  id: string;
  placeholder?: string;
  type?: string;
  description?: string;
  required?: boolean;
}) {
  return (
    <div className="dk-api-label">
      <label htmlFor={id}>
        <span>
          {label}
          {required && <span className="dk-param-required"> required</span>}
        </span>
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        title={description}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className="dk-api-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ResponseView({ response, id }: { response: PlaygroundResponse; id: string }) {
  const type = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  const body = useMemo(() => formatBody(response.body, type), [response.body, type]);
  const [tab, setTab] = useState('body');
  const tone = response.status < 300 ? 'ok' : response.status < 400 ? 'redirect' : 'error';
  return (
    <section className="dk-api-response" aria-label="Response">
      <div className="dk-api-response-head">
        <PaneTabs
          label="Response"
          idBase={id}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'body', label: 'Body' },
            { id: 'headers', label: `Headers (${response.headers.length})` },
          ]}
        />
        <span className="dk-api-status-code" data-tone={tone}>
          {response.status} {response.statusText}
        </span>
        <span>{Math.round(response.ms)} ms</span>
        <span>{formatSize(response.size)}</span>
      </div>
      <Pane idBase={id} id="body" active={tab}>
        {response.binary ? (
          <p className="dk-api-status">The body is binary ({formatSize(response.size)}) and is not shown.</p>
        ) : (
          <figure className="dk-code">
            <div className="dk-code-body">
              <CodeEditor
                readOnly
                value={body}
                language={languageForMime(type, body)}
                label="Response body"
                testId="api-response-body"
                lineNumbers
                foldable
                wrap
              />
              <CopyButton text={body} />
            </div>
          </figure>
        )}
        {response.truncated && <p className="dk-api-status">The body is longer than what is shown here.</p>}
      </Pane>
      <Pane idBase={id} id="headers" active={tab}>
        <dl className="dk-api-headers">
          {response.headers.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Pane>
    </section>
  );
}

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

