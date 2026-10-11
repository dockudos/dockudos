/** An error a caller can act on. `status` is the HTTP status the API layer answers with. */
export class PlatformError extends Error {
  readonly status: number;
  readonly code: string;
  /** Structured detail for the client, such as the files in conflict. */
  readonly details?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new PlatformError(400, code, message);
export const unauthorized = (message = 'Sign in to continue.') =>
  new PlatformError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this.') =>
  new PlatformError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') =>
  new PlatformError(404, 'not_found', message);
export const conflict = (
  message: string,
  code = 'conflict',
  details?: unknown,
) => new PlatformError(409, code, message, details);
export const tooMany = (message = 'Too many requests.') =>
  new PlatformError(429, 'rate_limited', message);
