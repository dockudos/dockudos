'use client';

import {
  type ApiMediaType,
  type ApiParameter,
  type ApiSecurityScheme,
  type AuthValues,
  type HttpRequest,
  type RequestValues,
  buildHttpRequest,
  defaultValues,
  pickSecurity,
  serverUrl,
  validateInput,
} from '@dockudos/core';
import { Loader2, Send, Wand2, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton } from '../copy-button.tsx';
import { Tab, Tabs } from '../tabs.tsx';
import { CodeEditor, languageForMime } from './code-editor.tsx';
import { useApiOperation } from './context.tsx';
import {
  type PlaygroundResponse,
  type SendOutcome,
  droppedHeaders,
  formatBody,
  sendRequest,
} from './send.ts';
import { CodeFigure } from './sections.tsx';
import { useAuthValues } from './store.ts';
import { type ToMarkdown } from '@dockudos/core';

const PROXY_ROUTE = '/api/playground';

/** The body to start with: the first example of the first JSON content type, else the first content type. */
function initialBody(content: Record<string, ApiMediaType>): { contentType: string; text: string } | undefined {
  const types = Object.keys(content);
  const mime = types.find((t) => /json/i.test(t)) ?? types[0];
  return mime ? { contentType: mime, text: exampleText(mime, content[mime]) } : undefined;
}

function exampleText(mime: string, media: ApiMediaType | undefined): string {
  const first = media && Object.values(media.examples)[0];
  if (!first) return '';
  if (typeof first.value === 'string') return first.value;
  if (/x-www-form-urlencoded/i.test(mime) && first.value && typeof first.value === 'object') {
    return new URLSearchParams(
      Object.entries(first.value as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    ).toString();
  }
  return JSON.stringify(first.value, null, 2);
}

/** Bodies the playground can send as text. */
const SENDABLE = /json|text\/|xml|x-www-form-urlencoded|yaml|graphql/i;

function bodyError(contentType: string, text: string): string | undefined {
  if (/json/i.test(contentType) && text.trim()) {
    try {
      JSON.parse(text);
    } catch (e) {
      return `Not valid JSON: ${(e as Error).message}`;
    }
  }
  return undefined;
}

type RequestPane = 'params' | 'auth' | 'headers' | 'body';

/** The pane that holds a field, to open it when the field has a problem. */
const paneOf = (key: string): RequestPane | undefined =>
  key === 'body'
    ? 'body'
    : /^(path|query):/.test(key)
      ? 'params'
      : /^(header|cookie):/.test(key)
        ? 'headers'
        : undefined;

/**
 * Try the operation: fill in the parameters, body and credentials, see the code for it in several languages, send it
 * and read the answer. Requests go from the browser to the API. Credentials are kept in this tab only.
 */
export function ApiPlayground() {
  const { data, proxy, languages } = useApiOperation();
  const { operation, servers, securitySchemes } = data;
  const interactive = !data.noPlayground;

  const [auth, setAuth] = useAuthValues();
  const [server, setServer] = useState(0);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [base, setBase] = useState(() => serverUrl(servers[0]));
  const content = operation.requestBody?.content ?? {};
  const [values, setValues] = useState<RequestValues>(() => defaultValues(operation, initialBody(content)));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome>();
  const controller = useRef<AbortController>(null);
  const id = useId();

  useEffect(() => () => controller.current?.abort(), []);

  const chooseServer = (index: number, vars: Record<string, string>) => {
    setServer(index);
    setVariables(vars);
    setBase(serverUrl(servers[index], vars));
  };

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const p of operation.parameters) {
      const problem = validateInput(p.schema, values[p.in][p.name] ?? '', p.required);
      if (problem) found[`${p.in}:${p.name}`] = problem;
    }
    if (operation.requestBody?.required && !values.body?.text.trim()) found.body = 'Required';
    else if (values.body) {
      const problem = bodyError(values.body.contentType, values.body.text);
      if (problem) found.body = problem;
    }
    if (!base.trim()) found.base = 'Give the address of the API';
    else if (!/^https?:\/\//i.test(base)) found.base = 'Must start with http:// or https://';
    return found;
  }, [operation, values, base]);

  const sample = (placeholders: boolean): HttpRequest =>
    buildHttpRequest(operation, securitySchemes, base.replace(/\/+$/, ''), values, auth, { placeholders });

  const schemeNames = [...new Set(operation.security.flatMap((alt) => Object.keys(alt)))].filter(
    (n) => securitySchemes[n],
  );
  const where = (place: ApiParameter['in'][]) => operation.parameters.filter((p) => place.includes(p.in));
  const paramList = where(['path', 'query']);
  const headerList = where(['header', 'cookie']);
  const panes: { id: RequestPane; label: string; count?: number; flag?: boolean }[] = [];
  if (paramList.length) panes.push({ id: 'params', label: 'Params', count: paramList.length });
  if (schemeNames.length) {
    panes.push({ id: 'auth', label: 'Authorization', flag: schemeNames.some((n) => Object.values(auth[n] ?? {}).some(Boolean)) });
  }
  if (headerList.length) panes.push({ id: 'headers', label: 'Headers', count: headerList.length });
  if (operation.requestBody) panes.push({ id: 'body', label: 'Body', flag: !!values.body?.text.trim() });
  const [chosen, setPane] = useState<RequestPane>();
  // Start where the work is: a required parameter, else the body, else the first tab.
  const start = paramList.some((p) => p.required) ? 'params' : operation.requestBody ? 'body' : panes[0]?.id;
  const pane = panes.find((p) => p.id === (chosen ?? start))?.id ?? panes[0]?.id;
  const badPanes = new Set(submitted ? Object.keys(errors).map(paneOf) : []);

  const send = async () => {
    setSubmitted(true);
    const first = Object.keys(errors).map(paneOf).find(Boolean);
    if (first) setPane(first);
    if (Object.keys(errors).length) return;
    controller.current?.abort();
    const abort = (controller.current = new AbortController());
    setBusy(true);
    setOutcome(undefined);
    const result = await sendRequest(sample(false), {
      signal: abort.signal,
      proxy: proxy ? PROXY_ROUTE : undefined,
    });
    if (!abort.signal.aborted) {
      setOutcome(result);
      setBusy(false);
    }
  };
  const cancel = () => {
    controller.current?.abort();
    setBusy(false);
  };

  const request = sample(true);
  const ignored = droppedHeaders(sample(false).headers);
  const path = request.url.startsWith(base.replace(/\/+$/, '')) ? request.url.slice(base.replace(/\/+$/, '').length) : operation.path;
  const vars = Object.entries(servers[server]?.variables ?? {});
  const setValue = (place: ApiParameter['in'], name: string, v: string) =>
    setValues((cur) => ({ ...cur, [place]: { ...cur[place], [name]: v } }));

  return (
    <div className="dk-api-playground">
      <Tabs items={languages.map((l) => l.label)} groupId="api-sample-language" className="dk-api-samples">
        {languages.map((l) => (
          <Tab key={l.id} value={l.label}>
            <CodeFigure code={l.generate(request)} language={l.highlight === 'bash' ? 'shell' : l.highlight} />
          </Tab>
        ))}
      </Tabs>

      {interactive && (
        <form
          className="dk-api-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void send();
          }}
        >
          <div className="dk-api-bar">
            <div className="dk-api-url" data-invalid={submitted && !!errors.base ? '' : undefined}>
              <span className="dk-api-method-badge" data-method={operation.method}>
                {operation.method.toUpperCase()}
              </span>
              {servers.length > 1 && (
                <select
                  aria-label="Server"
                  className="dk-api-server"
                  value={server}
                  onChange={(e) => chooseServer(Number(e.target.value), {})}
                >
                  {servers.map((s, i) => (
                    <option key={i} value={i}>
                      {s.description ? `${s.description} (${s.url})` : s.url}
                    </option>
                  ))}
                </select>
              )}
              <input
                id={`${id}-base`}
                aria-label="Base URL"
                className="dk-api-base"
                value={base}
                placeholder="https://api.example.com"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={submitted && !!errors.base}
                aria-describedby={submitted && errors.base ? `${id}-base-error` : undefined}
                onChange={(e) => setBase(e.target.value)}
              />
              <code className="dk-api-path" title={request.url}>
                {path}
              </code>
            </div>
            {busy ? (
              <button type="button" className="dk-api-send" data-busy="" onClick={cancel}>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Cancel
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className="dk-api-send">
                <Send className="size-4" aria-hidden="true" />
                Send request
              </button>
            )}
          </div>
          {submitted && errors.base && (
            <p id={`${id}-base-error`} className="dk-api-error" role="alert">
              {errors.base}
            </p>
          )}
          {vars.length > 0 && (
            <div className="dk-api-vars">
              {vars.map(([name, v]) => (
                <label key={name} className="dk-api-label">
                  <span>{name}</span>
                  {v.enum ? (
                    <select
                      value={variables[name] ?? v.default}
                      onChange={(e) => chooseServer(server, { ...variables, [name]: e.target.value })}
                    >
                      {v.enum.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={variables[name] ?? v.default}
                      onChange={(e) => chooseServer(server, { ...variables, [name]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          {pane && (
            <div className="dk-api-request">
              <PaneTabs
                label="Request"
                idBase={`${id}-req`}
                tabs={panes.map((p) => ({ ...p, bad: badPanes.has(p.id) }))}
                value={pane}
                onChange={(v) => setPane(v as RequestPane)}
              />
              <Pane idBase={`${id}-req`} id="params" active={pane}>
                {(['path', 'query'] as const).map((place) => {
                  const list = paramList.filter((p) => p.in === place);
                  return list.length ? (
                    <div key={place} className="dk-api-group">
                      <h4 className="dk-api-subhead">{place} parameters</h4>
                      {list.map((p) => (
                        <ParamInput
                          key={`${p.in}:${p.name}`}
                          param={p}
                          value={values[p.in][p.name] ?? ''}
                          error={submitted ? errors[`${p.in}:${p.name}`] : undefined}
                          id={`${id}-${p.in}-${p.name}`}
                          onChange={(v) => setValue(p.in, p.name, v)}
                        />
                      ))}
                    </div>
                  ) : null;
                })}
              </Pane>
              <Pane idBase={`${id}-req`} id="auth" active={pane}>
                <p className="dk-api-facts">
                  Kept in this browser tab only and sent only to the address above
                  {proxy ? ' (through this site, because the proxy is on)' : ''}.
                </p>
                {schemeNames.map((name) => (
                  <AuthFields
                    key={name}
                    name={name}
                    scheme={securitySchemes[name] as ApiSecurityScheme}
                    value={auth[name] ?? {}}
                    onChange={(v) => setAuth(name, v)}
                    id={`${id}-auth-${name}`}
                    active={name in (pickSecurity(operation, auth) ?? {})}
                  />
                ))}
              </Pane>
              <Pane idBase={`${id}-req`} id="headers" active={pane}>
                {headerList.map((p) => (
                  <ParamInput
                    key={`${p.in}:${p.name}`}
                    param={p}
                    value={values[p.in][p.name] ?? ''}
                    error={submitted ? errors[`${p.in}:${p.name}`] : undefined}
                    id={`${id}-${p.in}-${p.name}`}
                    onChange={(v) => setValue(p.in, p.name, v)}
                  />
                ))}
                {ignored.length > 0 && (
                  <p className="dk-api-status">
                    A browser does not let a page set {ignored.join(', ')}; {ignored.length > 1 ? 'they are' : 'it is'}{' '}
                    left out of the request. The code sample above has {ignored.length > 1 ? 'them' : 'it'}.
                  </p>
                )}
              </Pane>
              <Pane idBase={`${id}-req`} id="body" active={pane}>
                <BodyEditor
                  id={`${id}-body`}
                  content={content}
                  value={values.body}
                  error={submitted ? errors.body : undefined}
                  onChange={(body) => setValues((cur) => ({ ...cur, body }))}
                  onSubmit={() => void send()}
                />
              </Pane>
            </div>
          )}

          {submitted && Object.keys(errors).length > 0 && (
            <p className="dk-api-error" role="alert">
              Fix the {Object.keys(errors).length} highlighted field{Object.keys(errors).length > 1 ? 's' : ''} first.
            </p>
          )}

          <div aria-live="polite" className="dk-api-result">
            {busy && <p className="dk-api-status">Waiting for the API…</p>}
            {outcome && !outcome.ok && (
              <div className="dk-api-failure" role="alert">
                <strong>{outcome.message}</strong>
                {outcome.hint && <p>{outcome.hint}</p>}
              </div>
            )}
            {outcome?.ok && <ResponseView response={outcome.response} id={`${id}-res`} />}
          </div>
        </form>
      )}
    </div>
  );
}

interface TabSpec {
  id: string;
  label: string;
  count?: number;
  /** Something has been entered. */
  flag?: boolean;
  /** Something here needs fixing. */
  bad?: boolean;
}

/** A row of tabs (arrow keys move between them). The caller renders the panels with `Pane`. */
function PaneTabs({
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
function Pane({ id, active, idBase, children }: { id: string; active: string; idBase: string; children: ReactNode }) {
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

function BodyEditor({
  id,
  content,
  value,
  error,
  onChange,
  onSubmit,
}: {
  id: string;
  content: Record<string, ApiMediaType>;
  value: RequestValues['body'];
  error?: string;
  onChange: (body: NonNullable<RequestValues['body']>) => void;
  onSubmit: () => void;
}) {
  const types = Object.keys(content);
  const contentType = value?.contentType ?? types[0] ?? 'application/json';
  const text = value?.text ?? '';
  const isJson = /json/i.test(contentType);
  if (!SENDABLE.test(contentType)) {
    return (
      <p className="dk-api-status">
        The playground cannot send <code>{contentType}</code> bodies. Use the code sample above.
      </p>
    );
  }
  const beautify = () => {
    try {
      onChange({ contentType, text: JSON.stringify(JSON.parse(text), null, 2) });
    } catch {
      // not valid JSON: the editor already marks where
    }
  };
  return (
    <>
      <div className="dk-api-bodybar">
        {types.length > 1 ? (
          <select
            aria-label="Content type"
            value={contentType}
            onChange={(e) => onChange({ contentType: e.target.value, text: exampleText(e.target.value, content[e.target.value]) })}
          >
            {types.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        ) : (
          <code>{contentType}</code>
        )}
        {isJson && (
          <button type="button" className="dk-api-tool" onClick={beautify} disabled={!text.trim()}>
            <Wand2 className="size-3.5" aria-hidden="true" />
            Beautify
          </button>
        )}
        <span className="dk-api-hint">Ctrl/⌘ + Enter sends</span>
      </div>
      <CodeEditor
        value={text}
        language={languageForMime(contentType)}
        label={`Body (${contentType})`}
        invalid={!!error}
        describedBy={error ? `${id}-error` : undefined}
        placeholder="Request body"
        lineNumbers
        onChange={(next) => onChange({ contentType, text: next })}
        onSubmit={onSubmit}
      />
      {error && (
        <p id={`${id}-error`} className="dk-api-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function FieldInput({
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

function ParamInput({
  param,
  value,
  error,
  id,
  onChange,
}: {
  param: ApiParameter;
  value: string;
  error?: string;
  id: string;
  onChange: (v: string) => void;
}) {
  const choices = param.schema?.enum?.map(String) ?? (param.schema?.type === 'boolean' ? ['true', 'false'] : undefined);
  if (choices) {
    return (
      <div className="dk-api-label">
        <label htmlFor={id}>
          <span>
            {param.name}
            {param.required && <span className="dk-param-required"> required</span>}
          </span>
        </label>
        <select
          id={id}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{param.required ? 'Choose…' : '(not set)'}</option>
          {choices.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {error && (
          <p id={`${id}-error`} className="dk-api-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <FieldInput
      label={param.name}
      value={value}
      onChange={onChange}
      error={error}
      id={id}
      required={param.required}
      description={param.description}
      placeholder={param.schema?.type === 'array' ? 'a,b,c' : param.schema?.format ?? param.schema?.type}
    />
  );
}

function AuthFields({
  name,
  scheme,
  value,
  onChange,
  id,
  active,
}: {
  name: string;
  scheme: ApiSecurityScheme;
  value: AuthValues[string];
  onChange: (v: AuthValues[string]) => void;
  id: string;
  active: boolean;
}) {
  const title = `${name}${active ? '' : ' (alternative)'}`;
  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return (
      <>
        <FieldInput label={`${title}: username`} id={`${id}-u`} value={value.username ?? ''} onChange={(username) => onChange({ ...value, username })} />
        <FieldInput label={`${title}: password`} id={`${id}-p`} type="password" value={value.password ?? ''} onChange={(password) => onChange({ ...value, password })} />
      </>
    );
  }
  const label =
    scheme.type === 'apiKey'
      ? `${title}: API key (${scheme.in} ${scheme.name})`
      : scheme.type === 'http'
        ? `${title}: ${scheme.scheme === 'bearer' ? 'bearer token' : `${scheme.scheme} credentials`}`
        : `${title}: access token`;
  return (
    <FieldInput
      label={label}
      id={id}
      type="password"
      value={value.value ?? ''}
      onChange={(v) => onChange({ ...value, value: v })}
      description={scheme.description}
    />
  );
}

function ResponseView({ response, id }: { response: PlaygroundResponse; id: string }) {
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

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

ApiPlayground.toMarkdown = (() => '') satisfies ToMarkdown;
