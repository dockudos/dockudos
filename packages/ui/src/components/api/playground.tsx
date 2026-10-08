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
import { Loader2, Send } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton } from '../copy-button.tsx';
import { Tab } from '../tab-panel.tsx';
import { Tabs } from '../tabs.tsx';
import { useApiOperation } from './context.tsx';
import { CodeFigure } from './sections.tsx';
import {
  type PlaygroundResponse,
  type SendOutcome,
  droppedHeaders,
  formatBody,
  sendRequest,
} from './send.ts';
import { useAuthValues } from './store.ts';

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

  const send = async () => {
    setSubmitted(true);
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

  const schemeNames = [...new Set(operation.security.flatMap((alt) => Object.keys(alt)))].filter(
    (n) => securitySchemes[n],
  );
  const request = sample(true);
  const ignored = droppedHeaders(sample(false).headers);

  return (
    <div className="dk-api-playground">
      <Tabs items={languages.map((l) => l.label)} groupId="api-sample-language" className="dk-api-samples">
        {languages.map((l) => (
          <Tab key={l.id} value={l.label}>
            <CodeFigure code={l.generate(request)} />
          </Tab>
        ))}
      </Tabs>

      {interactive && (
        <form
          className="dk-api-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset className="dk-api-fieldset">
            <legend>Server</legend>
            {servers.length > 1 && (
              <label className="dk-api-label">
                <span>Server</span>
                <select
                  value={server}
                  onChange={(e) => {
                    const index = Number(e.target.value);
                    chooseServer(index, {});
                  }}
                >
                  {servers.map((s, i) => (
                    <option key={i} value={i}>
                      {s.description ? `${s.description} (${s.url})` : s.url}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {Object.entries(servers[server]?.variables ?? {}).map(([name, v]) => (
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
            <FieldInput
              label="Base URL"
              value={base}
              onChange={setBase}
              error={submitted ? errors.base : undefined}
              id={`${id}-base`}
              placeholder="https://api.example.com"
            />
          </fieldset>

          {schemeNames.length > 0 && (
            <fieldset className="dk-api-fieldset">
              <legend>Authorization</legend>
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
            </fieldset>
          )}

          {(['path', 'query', 'header', 'cookie'] as const).map((where) => {
            const params = operation.parameters.filter((p) => p.in === where);
            if (!params.length) return null;
            return (
              <fieldset key={where} className="dk-api-fieldset">
                <legend>{where[0]?.toUpperCase()}{where.slice(1)} parameters</legend>
                {params.map((p) => (
                  <ParamInput
                    key={`${p.in}:${p.name}`}
                    param={p}
                    value={values[p.in][p.name] ?? ''}
                    error={submitted ? errors[`${p.in}:${p.name}`] : undefined}
                    id={`${id}-${p.in}-${p.name}`}
                    onChange={(v) => setValues((cur) => ({ ...cur, [p.in]: { ...cur[p.in], [p.name]: v } }))}
                  />
                ))}
              </fieldset>
            );
          })}

          {operation.requestBody && (
            <fieldset className="dk-api-fieldset">
              <legend>Request body</legend>
              {Object.keys(content).length > 1 && (
                <label className="dk-api-label">
                  <span>Content type</span>
                  <select
                    value={values.body?.contentType}
                    onChange={(e) => {
                      const mime = e.target.value;
                      setValues((cur) => ({ ...cur, body: { contentType: mime, text: exampleText(mime, content[mime]) } }));
                    }}
                  >
                    {Object.keys(content).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
              )}
              {values.body && !SENDABLE.test(values.body.contentType) ? (
                <p className="dk-api-status">
                  The playground cannot send <code>{values.body.contentType}</code> bodies. Use the code sample above.
                </p>
              ) : (
                <>
                  <label className="dk-api-label dk-api-label-block" htmlFor={`${id}-body`}>
                    <span>Body{values.body ? ` (${values.body.contentType})` : ''}</span>
                  </label>
                  <textarea
                    id={`${id}-body`}
                    className="dk-api-textarea"
                    spellCheck={false}
                    rows={Math.min(18, Math.max(4, (values.body?.text.split('\n').length ?? 0) + 1))}
                    value={values.body?.text ?? ''}
                    aria-invalid={submitted && !!errors.body}
                    aria-describedby={submitted && errors.body ? `${id}-body-error` : undefined}
                    onChange={(e) =>
                      setValues((cur) => ({
                        ...cur,
                        body: { contentType: cur.body?.contentType ?? Object.keys(content)[0] ?? 'application/json', text: e.target.value },
                      }))
                    }
                  />
                  {submitted && errors.body && (
                    <p id={`${id}-body-error`} className="dk-api-error" role="alert">
                      {errors.body}
                    </p>
                  )}
                </>
              )}
            </fieldset>
          )}

          {ignored.length > 0 && (
            <p className="dk-api-status">
              A browser does not let a page set {ignored.join(', ')}; {ignored.length > 1 ? 'they are' : 'it is'} left out
              of the request. The code sample above has {ignored.length > 1 ? 'them' : 'it'}.
            </p>
          )}

          <div className="dk-api-actions">
            <button type="submit" className="dk-api-send" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {busy ? 'Sending…' : 'Send request'}
            </button>
            {submitted && Object.keys(errors).length > 0 && (
              <span className="dk-api-error" role="alert">
                Fix the {Object.keys(errors).length} highlighted field{Object.keys(errors).length > 1 ? 's' : ''} first.
              </span>
            )}
          </div>

          <div aria-live="polite" className="dk-api-result">
            {outcome && !outcome.ok && (
              <div className="dk-api-failure" role="alert">
                <strong>{outcome.message}</strong>
                {outcome.hint && <p>{outcome.hint}</p>}
              </div>
            )}
            {outcome?.ok && <ResponseView response={outcome.response} />}
          </div>
        </form>
      )}
    </div>
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

function ResponseView({ response }: { response: PlaygroundResponse }) {
  const type = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  const body = useMemo(() => formatBody(response.body, type), [response.body, type]);
  const tone = response.status < 300 ? 'ok' : response.status < 400 ? 'redirect' : 'error';
  return (
    <section className="dk-api-response" aria-label="Response">
      <div className="dk-api-response-head">
        <span className="dk-api-status-code" data-tone={tone}>
          {response.status} {response.statusText}
        </span>
        <span>{Math.round(response.ms)} ms</span>
        <span>{formatSize(response.size)}</span>
      </div>
      <details className="dk-api-headers">
        <summary>Headers ({response.headers.length})</summary>
        <dl>
          {response.headers.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
      {response.binary ? (
        <p className="dk-api-status">The body is binary ({formatSize(response.size)}) and is not shown.</p>
      ) : (
        <figure className="dk-code">
          <div className="dk-code-body">
            <pre className="dk-pre" tabIndex={0} data-testid="api-response-body">
              <code>{body}</code>
            </pre>
            <CopyButton />
          </div>
        </figure>
      )}
      {response.truncated && <p className="dk-api-status">The body is longer than what is shown here.</p>}
    </section>
  );
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
