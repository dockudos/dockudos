import { cn } from '../lib/utils.ts';

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const COLOR: Record<HttpMethod, string> = {
  GET: 'var(--dk-callout-info)',
  POST: 'var(--dk-callout-tip)',
  PUT: 'var(--dk-callout-warning)',
  PATCH: 'var(--dk-callout-warning)',
  DELETE: 'var(--dk-callout-danger)',
  HEAD: 'var(--dk-callout-note)',
  OPTIONS: 'var(--dk-callout-note)',
};

export interface EndpointProps {
  method: HttpMethod;
  /** The path, with `{placeholders}` if it has them: `/v1/users/{id}`. */
  path: string;
  /** Base URL shown dimmed in front of the path. */
  baseUrl?: string;
}

/** An HTTP method and path on one line: `POST /v1/users`. */
export function Endpoint({ method, path, baseUrl }: EndpointProps) {
  const known = HTTP_METHODS.includes(method) ? method : 'GET';
  return (
    <div
      className="dk-endpoint"
      style={{ '--c': COLOR[known] } as React.CSSProperties}
    >
      <span className={cn('dk-endpoint-method')} data-method={known}>
        {known}
      </span>
      <code className="dk-endpoint-path">
        {baseUrl && <span className="dk-endpoint-base">{baseUrl}</span>}
        {path}
      </code>
    </div>
  );
}
