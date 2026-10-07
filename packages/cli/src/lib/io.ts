import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { FSWatcher } from 'node:fs';

/** Everything the commands touch outside their own logic, so tests can replace it. */
export interface Env {
  cwd: string;
  /** `process.env`-like. */
  vars: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Whether stdin is an interactive terminal. */
  interactive: boolean;
  /** Ask a question; resolves with the answer, or the default when empty. */
  ask: (question: string, fallback: string) => Promise<string>;
  spawn: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => ChildProcess;
  watch: (path: string, onChange: () => void) => FSWatcher | { close(): void };
  /** A TCP port nothing is listening on. */
  freePort: () => Promise<number>;
  fetch: (url: string) => Promise<{ status: number }>;
  /** Print a page to PDF with headless Chrome. */
  renderPdf: (options: PdfOptions) => Promise<Uint8Array>;
}

export interface PdfOptions {
  url: string;
  /** Path of a Chrome or Chromium executable. Found automatically when not given. */
  chrome?: string;
  pageSize: 'A4' | 'Letter';
  /** Shown in the footer of every page. */
  title: string;
  /** How long to wait for the page to be ready, in ms. */
  timeout: number;
}

export class CliError extends Error {
  /** Process exit code. */
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}
