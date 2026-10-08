/** Options for {@link connect}. */
export interface ConnectOptions {
  /** Base URL of the API. */
  url: string;
  /** Seconds to wait. @default 30 */
  timeout?: number;
  /** Use `url` instead. @deprecated */
  host?: string;
}

/**
 * Open a connection.
 *
 * @param options - How to connect.
 * @param retries How many times to retry.
 * @example
 * const c = connect({ url: 'https://x.test' });
 */
export function connect(options: ConnectOptions, retries = 3): Client {
  return new Client(options.url + retries);
}

/** A client. */
export class Client {
  /** The address. */
  readonly address: string;
  constructor(address: string) {
    this.address = address;
  }
  /** Say hello. */
  hello(name: string): string {
    return name;
  }
}

/** How verbose. */
export type Level = 'debug' | 'info' | { custom: string };

export enum Color {
  /** Red. */
  Red,
  Blue,
}

/** The default timeout. */
export const DEFAULT_TIMEOUT = 30 as number;
