import type {
  ApiOperation,
  ApiParameter,
  ApiSecurityScheme,
  ApiServer,
} from './types.ts';

/** What a person entered to try an operation. All values are strings, as typed. */
export interface RequestValues {
  path: Record<string, string>;
  query: Record<string, string>;
  header: Record<string, string>;
  cookie: Record<string, string>;
  /** The request body as text, with its media type. */
  body?: { contentType: string; text: string };
}

/** What a person entered for authentication, by security scheme name. */
export type AuthValues = Record<
  string,
  { value?: string; username?: string; password?: string }
>;

export interface HttpRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: { contentType: string; text: string };
}

export function emptyValues(): RequestValues {
  return { path: {}, query: {}, header: {}, cookie: {} };
}

/** The server URL with its `{variables}` replaced by the chosen values or their defaults. */
export function serverUrl(
  server: ApiServer | undefined,
  chosen: Record<string, string> = {},
): string {
  if (!server) return '';
  return server.url
    .replace(/\{([^}]+)\}/g, (all, name: string) => {
      const variable = server.variables?.[name];
      return chosen[name] || variable?.default || all;
    })
    .replace(/\/+$/, '');
}

export const utf8ToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/** Which alternative of an operation's security to use: the first one the person filled in, else the first. */
export function pickSecurity(
  operation: Pick<ApiOperation, 'security'>,
  auth: AuthValues,
): Record<string, string[]> | undefined {
  const filled = (name: string) => {
    const a = auth[name];
    return !!(a && (a.value || a.username || a.password));
  };
  return (
    operation.security.find((alt) => Object.keys(alt).every(filled)) ??
    operation.security[0]
  );
}

export interface BuildOptions {
  /** Show `YOUR_TOKEN` where a secret is missing (for code samples); otherwise leave the header out. */
  placeholders?: boolean;
}

/** Turn what a person entered into an HTTP request: path filled, query serialised, authentication applied. */
export function buildHttpRequest(
  operation: ApiOperation,
  schemes: Record<string, ApiSecurityScheme>,
  base: string,
  values: RequestValues,
  auth: AuthValues,
  { placeholders = false }: BuildOptions = {},
): HttpRequest {
  const path = operation.path.replace(/\{([^}]+)\}/g, (all, name: string) => {
    const v = values.path[name];
    return v ? encodeURIComponent(v) : placeholders ? `{${name}}` : all;
  });

  const query: [string, string][] = [];
  const headers: [string, string][] = [];
  const cookies: [string, string][] = [];

  for (const p of operation.parameters) {
    const raw = values[p.in][p.name];
    if (raw === undefined || raw === '') continue;
    if (p.in === 'query') query.push(...serialiseQuery(p, raw));
    else if (p.in === 'header') headers.push([p.name, raw]);
    else if (p.in === 'cookie') cookies.push([p.name, raw]);
  }

  const security = pickSecurity(operation, auth);
  for (const name of Object.keys(security ?? {})) {
    const scheme = schemes[name];
    const a = auth[name] ?? {};
    if (!scheme) continue;
    const placeholder = (text: string) => (placeholders ? text : undefined);
    if (scheme.type === 'apiKey') {
      const v = a.value || placeholder('YOUR_API_KEY');
      if (!v) continue;
      if (scheme.in === 'header') headers.push([scheme.name, v]);
      else if (scheme.in === 'query') query.push([scheme.name, v]);
      else cookies.push([scheme.name, v]);
    } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
      if (a.username || a.password) {
        headers.push([
          'Authorization',
          `Basic ${utf8ToBase64(`${a.username ?? ''}:${a.password ?? ''}`)}`,
        ]);
      } else if (placeholders) {
        headers.push(['Authorization', 'Basic YOUR_BASE64_CREDENTIALS']);
      }
    } else if (
      scheme.type === 'http' ||
      scheme.type === 'oauth2' ||
      scheme.type === 'openIdConnect'
    ) {
      const v = a.value || placeholder('YOUR_TOKEN');
      const word =
        scheme.type === 'http' && scheme.scheme !== 'bearer'
          ? scheme.scheme
          : 'Bearer';
      if (v) headers.push(['Authorization', `${capitalise(word)} ${v}`]);
    }
  }
  if (cookies.length) {
    headers.push(['Cookie', cookies.map(([k, v]) => `${k}=${v}`).join('; ')]);
  }

  const body = values.body?.text ? values.body : undefined;
  if (body) headers.unshift(['Content-Type', body.contentType]);

  const qs = query
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return {
    method: operation.method.toUpperCase(),
    url: `${base}${path}${qs ? `?${qs}` : ''}`,
    headers,
    ...(body && { body }),
  };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One typed value for a query parameter into `name=value` pairs. A list is entered as `a,b,c`; it is sent as the
 * parameter's `style` says (repeated by default, as `form` with `explode` does).
 */
function serialiseQuery(p: ApiParameter, raw: string): [string, string][] {
  const isArray = p.schema?.type === 'array';
  if (!isArray) return [[p.name, raw]];
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const explode = p.explode ?? (p.style ?? 'form') === 'form';
  if (explode && (p.style ?? 'form') === 'form') {
    return items.map((i) => [p.name, i]);
  }
  const joiner =
    p.style === 'spaceDelimited'
      ? ' '
      : p.style === 'pipeDelimited'
        ? '|'
        : ',';
  return [[p.name, items.join(joiner)]];
}

/** The people-visible default text of each parameter, to start the form with. */
export function defaultValues(
  operation: ApiOperation,
  bodyText?: { contentType: string; text: string },
): RequestValues {
  const values = emptyValues();
  for (const p of operation.parameters) {
    const given = p.example ?? p.schema?.examples?.[0] ?? p.schema?.default;
    if (given !== undefined && given !== null) {
      values[p.in][p.name] = Array.isArray(given)
        ? given.join(',')
        : String(given);
    }
  }
  if (bodyText) values.body = bodyText;
  return values;
}
