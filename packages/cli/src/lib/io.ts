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
