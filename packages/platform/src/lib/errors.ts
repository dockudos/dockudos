/** An error a caller can act on. `status` is the HTTP status the API layer answers with. */
export class PlatformError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.code = code;
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
export const conflict = (message: string, code = 'conflict') =>
  new PlatformError(409, code, message);
export const tooMany = (message = 'Too many requests.') =>
  new PlatformError(429, 'rate_limited', message);
