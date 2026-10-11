import { spawn } from 'node:child_process';

export interface RunInput {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Receives output as it arrives (already capped). */
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

export type CommandRunner = (input: RunInput) => Promise<{ code: number }>;

/**
 * Run a command with a **minimal** environment: the platform's own variables (database URL, tokens, session secret)
 * are not passed, because the command runs code from a repository. Time and output are capped and the whole process
 * group is killed on timeout or abort.
 */
export const spawnRunner: CommandRunner = ({
  cmd,
  args,
  cwd,
  env = {},
  timeoutMs = 900_000,
  onOutput,
  signal,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: cwd,
        CI: '1',
        NO_COLOR: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let bytes = 0;
    const take = (b: Buffer) => {
      bytes += b.length;
      if (bytes <= 2_000_000) onOutput?.(b.toString('utf8'));
      else if (bytes - b.length <= 2_000_000)
        onOutput?.('\n[output truncated]\n');
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      onOutput?.(`\n[killed: exceeded ${Math.round(timeoutMs / 1000)} s]\n`);
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? (sig ? 137 : 1) });
    });
  });
